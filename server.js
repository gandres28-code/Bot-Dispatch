const express = require("express");

const app = express();

// 🔥 IMPORTANTE: permite leer JSON
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Bot activo ✅");
});

app.post("/webhook", (req, res) => {
  try {

    console.log("🔥 WEBHOOK RECIBIDO");
    console.log("BODY:", req.body);

    const message = req.body?.body;

    if (!message) {
      return res.json({
        error: "No message received"
      });
    }

    res.json({
      ok: true,
      received: message
    });

  } catch (err) {
    console.log("ERROR:", err.message);
    res.status(500).send("error interno");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en", PORT);
});
