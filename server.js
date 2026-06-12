if (image) {

  try {
    await axios.post(
      "https://gate.whapi.cloud/messages/image",
      {
        to: OPERATIONS_GROUP_ID,
        media: image,
        caption: finalMessage
      },
      {
        headers: {
          Authorization: `Bearer ${WHAPI_TOKEN}`
        }
      }
    );

    console.log("📸 Imagen enviada a OPERACIONES");

  } catch (err) {

    console.log("⚠️ Fallback: enviando referencia");

    await axios.post(
      "https://gate.whapi.cloud/messages/text",
      {
        to: OPERATIONS_GROUP_ID,
        body:
`👷 ${employee}

${finalMessage}

📌 Evidencia disponible en chat original
🆔 Message ID: ${msg?.id}
📍 Chat: ${chatId}`
      },
      {
        headers: {
          Authorization: `Bearer ${WHAPI_TOKEN}`
        }
      }
    );
  }

} else {

  await axios.post(
    "https://gate.whapi.cloud/messages/text",
    {
      to: OPERATIONS_GROUP_ID,
      body: finalMessage
    },
    {
      headers: {
        Authorization: `Bearer ${WHAPI_TOKEN}`
      }
    }
  );
}
