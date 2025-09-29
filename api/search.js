import OpenAI from "openai";
import axios from "axios";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function searchProducts(query, size, color, { debug = false } = {}) {
  try {
    const url = new URL(`${process.env.WOO_URL}/products`);
    url.searchParams.set("search", query || "");
    url.searchParams.set("per_page", "5");

    // 👉 WooCommerce vuole parametri attribute ripetuti, NON attribute[]
    if (color) url.searchParams.append("attribute", `pa_colore=${color}`);
    if (size)  url.searchParams.append("attribute", `pa_taglia=${size}`);

    const finalUrl = url.toString();

    const response = await axios.get(finalUrl, {
      auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET,
      },
    });

    const results = response.data.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      stock: p.stock_status,
      url: p.permalink,
    }));

    return debug ? { results, meta: { finalUrl, count: results.length } } : { results };
  } catch (err) {
    const error = err.response?.data || err.message;
    if (debug) return { results: [], meta: { error } };
    return { results: [] };
  }
}

export default async function handler(req, res) {
  const { message, q, size, color, debug } = req.query;

  // 🔎 Bypass AI: consente test diretti con ?q=&size=&color=
  if (q) {
    const data = await searchProducts(q, size, color, { debug: !!debug });
    return res.status(200).json(data);
  }

  // 🧠 Percorso con AI + function calling
  const functions = [
    {
      name: "search_products",
      description: "Cerca prodotti WooCommerce in base a query, taglia e colore",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          size: { type: "string" },
          color: { type: "string" }
        },
        required: ["query"]
      }
    }
  ];

  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: message || "" }],
    functions,
    function_call: "auto"
  });

  const fnCall = chat.choices?.[0]?.message?.function_call;

  if (fnCall?.name === "search_products") {
    const args = JSON.parse(fnCall.arguments || "{}");
    const data = await searchProducts(args.query, args.size, args.color, { debug: !!debug });
    return res.status(200).json(data);
  }

  return res.status(200).json({ reply: chat.choices?.[0]?.message?.content || "" });
}
