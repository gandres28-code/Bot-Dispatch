'use strict';
function normalizeRoomValue(value) {
  const text = String(value || "").toUpperCase().trim();
  const match = text.match(/(\d{2,4})\s*([A-Z])?/);

  if (!match) {
    return text
      .replace(/\s+/g, " ")
      .replace(/[^A-Z0-9]/g, "")
      .trim();
  }

  return `${match[1]}${match[2] || ""}`;
}

module.exports={normalizeRoomValue};
