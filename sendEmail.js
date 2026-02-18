
// ================= EMAIL =================

async function sendEmail(game, price) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Steam Alerts <onboarding@resend.dev>",
      to: [ALERT_EMAIL],
      subject: `🔥 ${game.name} is ₹${price}!`,
      html: `
        <h2>${game.name} Price Alert</h2>
        <p>Current Price: ₹${price}</p>
        <p>Your Target: ₹${game.targetPrice}</p>
        <a href="https://store.steampowered.com/${game.type}/${game.id}">
          View on Steam
        </a>
      `
    }),
  });

  return response.ok;
}