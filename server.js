const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => {
  res.send("Bot activo y funcionando ✅");
});


app.get("/webhook", (req, res) => {
  res.send("Webhook listo ✅");
});


app.post("/webhook", async (req, res) => {

  try {

    const message =
      req.body?.body ||
      req.body?.text ||
      req.body?.message ||
      "Mensaje vacío";


    console.log("Mensaje recibido:", message);


    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un asistente de operaciones de housekeeping.

Analiza mensajes y extrae:
- Unidad
- Persona
- Estado
- Problema
- Solicitud

Estados:
ENTRANDO
LISTA
INSPECCIONADA
PROBLEMA
NECESITA SUMINISTROS

Responde en formato claro para un supervisor.
`
          },
          {
            role: "user",
            content: message
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );


    console.log(
      response.data.choices[0].message.content
    );


    res.sendStatus(200);


  } catch(error){

    console.log(error.response?.data || error.message);

    res.sendStatus(200);

  }

});


const PORT = process.env.PORT || 3000;


app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
