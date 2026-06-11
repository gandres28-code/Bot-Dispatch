const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Bot activo y funcionando ✅");
});

app.get("/webhook", (req, res) => {
  res.send("Webhook listo ✅");
});

app.post("/webhook", (req, res) => {
  console.log("Mensaje recibido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
