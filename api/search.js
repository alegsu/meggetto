import OpenAI from "openai";
import axios from "axios";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 🔹 Cerca prodotti WooCommerce per query, taglia e colore
 */
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

    return debug ? { results, meta: { url: url.toString(), count: results.length } } : { results };
  } catch (err) {
    console.error(err.response?.data || err.message);
    return { results: [] };
  }
}

/**
 * 🔹 Controlla la disponibilità di un prodotto in una taglia specifica
 * Può ricevere productId o productUrl
 */
async function checkStock({ productUrl, productId, size }) {
  try {
    let finalProductId = productId;

    // Se non ho ID ma ho l'URL, ricavo slug → ID
    if (!finalProductId && productUrl) {
      const slug = productUrl.split("/").filter(Boolean).pop();
      const productResp = await axios.get(`${process.env.WOO_URL}/products`, {
        auth: {
          username: process.env.WC_KEY,
          password: process.env.WC_SECRET,
        },
        params: { slug },
      });

      if (!productResp.data.length) {
        return { error: `Prodotto non trovato per slug: ${slug}` };
      }
      finalProductId = productResp.data[0].id;
    }

    if (!finalProductId) {
      return { error: "Serve almeno un productId o un productUrl" };
    }

    // Recupera varianti del prodotto
    const varResp = await axios.get(`${process.env.WOO_URL}/products/${finalProductId}/variations`, {
      auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET,
      },
      params: { per_page: 50 },
    });

    // Cerca la variante con la taglia richiesta
    const variation = varResp.data.find((v) =>
      v.attributes.some(
        (a) =>
          a.name.toLowerCase().includes("taglia") &&
          a.option.toLowerCase() === size.toLowerCase()
      )
    );

    if (!variation) {
      return { error: `Nessuna variante trovata con taglia ${size}` };
    }

    return {
      productId: finalProductId,
      product: variation.name || "",
      size,
      stock_quantity: variation.stock_quantity ?? null,
      stock_status: variation.stock_status,
      sku: variation.sku,
    };
  } catch (err) {
    console.error(err.response?.data || err.message);
    return { error: "Errore durante il check stock" };
  }
}

/**
 * 🔹 Endpoint principale
 */
export default async function handler(req, res) {
  const { message, q, size, color, url, productId, debug } = req.query;

  // 🟢 Debug diretto stock (senza AI)
  if ((url || productId) && size) {
    const data = await checkStock({ productUrl: url, productId, size });
    return res.status(200).json(data);
  }

  // 🟢 Debug diretto search (senza AI)
  if (q) {
    const data = await searchProducts(q, size, color, { debug: !!debug });
    return res.status(200).json(data);
  }

  // 🧠 Percorso AI con function calling
  const functions = [
    {
      name: "search_products",
      description: "Cerca prodotti WooCommerce in base a query, taglia e colore",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          size: { type: "string" },
          color: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "check_stock",
      description: "Verifica la disponibilità di un prodotto in una taglia specifica",
      parameters: {
        type: "object",
        properties: {
          productUrl: { type: "string", description: "URL del prodotto WooCommerce" },
          productId: { type: "number", description: "ID numerico del prodotto WooCommerce" },
          size: { type: "string", description: "Taglia da verificare (es. 44)" },
        },
        required: ["size"],
      },
    },
  ];

  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: message || "" }],
    functions,
    function_call: "auto",
  });

  const fnCall = chat.choices?.[0]?.message?.function_call;

  if (fnCall?.name === "search_products") {
    const args = JSON.parse(fnCall.arguments || "{}");
    const data = await searchProducts(args.query, args.size, args.color, { debug: !!debug });
    return res.status(200).json(data);
  }

  if (fnCall?.name === "check_stock") {
    const args = JSON.parse(fnCall.arguments || "{}");
    const data = await checkStock(args);
    return res.status(200).json(data);
  }

  return res.status(200).json({
    reply: chat.choices?.[0]?.message?.content || "Nessuna risposta dall'assistente",
  });
}
