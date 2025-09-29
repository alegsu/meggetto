import OpenAI from "openai";
import axios from "axios";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function searchProducts(query, size, color) {
  try {
    const params = {
      search: query,
      per_page: 5
    };

    if (size) {
      params["attribute"] = `pa_taglia=${size}`;
    }
    if (color) {
      // Se già presente un attribute, aggiungiamo come array
      if (!params["attribute"]) {
        params["attribute"] = `pa_colore=${color}`;
      } else {
        // WooCommerce accetta più parametri attribute[] in querystring
        params["attribute[]"] = [`pa_taglia=${size}`, `pa_colore=${color}`];
      }
    }

    const response = await axios.get(`${process.env.WOO_URL}/products`, {
      auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET
      },
      params
    });

    return response.data.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      stock: p.stock_status,
      url: p.permalink
    }));
  } catch (err) {
    console.error(err.response?.data || err.message);
    return [];
  }
}


export default async function handler(req, res) {
  const { message } = req.query;

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
    messages: [{ role: "user", content: message }],
    functions,
    function_call: "auto"
  });

  const fnCall = chat.choices[0].message.function_call;

  if (fnCall?.name === "search_products") {
    const args = JSON.parse(fnCall.arguments);
    const results = await searchProducts(args.query, args.size, args.color);
    return res.status(200).json({ results });
  }

  return res.status(200).json({ reply: chat.choices[0].message.content });
}
