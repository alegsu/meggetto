import OpenAI from "openai";
import axios from "axios";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔹 Cerca prodotti
async function searchProducts(query, size, color, { debug = false } = {}) {
  try {
    const url = new URL(`${process.env.WOO_URL}/products`);
    url.searchParams.set("search", query || "");
    url.searchParams.set("per_page", "5");

    if (color) url.searchParams.append("attribute", `pa_colore=${color}`);
    if (size) url.searchParams.append("attribute", `pa_taglia=${size}`);

    const response = await axios.get(url.toString(), {
      auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET,
      },
    });

    const results = response.data.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      stock: p.stock_status,
      url: p.permalink,
    }));

    return { results };
  } catch (err) {
    console.error(err.response?.data || err.message);
    return { results: [] };
  }
}

// 🔹 Controlla quantità stock di una variante
async function checkStock(productUrl, size) {
  try {
    // 1. Ricava lo slug dall'URL (es. /shop/687174006007black/ -> 687174006007black)
    const slug = productUrl.split("/").filter(Boolean).pop();

    // 2. Trova l'ID del prodotto da WooCommerce
    const productResp = await axios.get(`${process.env.WOO_URL}/products`, {
      auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET,
      },
      params: { slug }
    });

    if (!productResp.data.length) {
      return { error: `Prodotto non trovato per slug: ${slug}` };
    }

    const productId = productResp.data[0].id;

    // 3. Recupera le varianti del prodotto
    const varResp = await axios.get(`${process.env.WOO_URL}/products/${productId}/variations`, {
      auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET,
      },
      params: { per_page: 50 }
    });

    // 4. Cerca la variante con la taglia richiesta
    const variation = varResp.data.find(v =>
      v.attributes.some(a =>
        a.name.toLowerCase().includes("taglia") &&
        a.option.toLowerCase() === size.toLowerCase()
      )
    );

    if (!variation) {
      return { error: `Nessuna variante trovata con taglia ${size}` };
    }

    return {
      product: productResp.data[0].name,
      size: size,
      stock_quantity: variation.stock_quantity ?? null,
      stock_status: variation.stock_status,
      sku: variation.sku,
    };

  } catch (err) {
    console.error(err.response?.data || err.message);
    return { error: "Errore durante il check stock" };
  }
}

export default async function handler(req, res) {
  const { message, q, size, color, url, debug } = req.query;

  // 🔎 Endpoint diretto per debug stock
  if (url && size) {
    const data = await checkStock(url, size);
    return res.status(200).json(data);
  }

  // 🔎 Endpoint diretto per debug search
  if (q) {
    const data = await searchProducts(q, size, color, { debug: !!debug });
    return res.status(200).json(data);
  }

  // 🧠 AI con function calling
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
    },
    {
      name: "check_stock",
      description: "Verifica la disponibilità di un prodotto in una taglia specifica",
      parameters: {
        type: "object",
        properties: {
          productUrl: { type: "string", description: "URL del prodotto su WooCommerce" },
          size: { type: "string", description: "Taglia da verificare (es. 44)" }
        },
        required: ["productUrl", "size"]
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

  if (fnCall?.name === "check_stock") {
    const args = JSON.parse(fnCall.arguments || "{}");
    const data = await checkStock(args.productUrl, args.size);
    return res.status(200).json(data);
  }

  return res.status(200).json({ reply: chat.choices?.[0]?.message?.content || "" });
}
