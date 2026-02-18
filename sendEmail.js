// ================= EMAIL =================
export async function sendEmail(discountedGames) {
  const gameCards = discountedGames
    .map(
      (game) => `
      <tr>
        <td style="padding:20px;border-bottom:1px solid #eee;">
          <h3 style="margin:0 0 8px 0;color:#1b2838;">${game.name}</h3>
          <p style="margin:4px 0;">
            <span style="font-weight:bold;">Current:</span> ₹${game.currentPrice}
          </p>
          <p style="margin:4px 0;">
            <span style="font-weight:bold;">Your Target:</span> ₹${game.targetPrice}
          </p>
          <a href="https://store.steampowered.com/${game.type}/${game.id}"
             style="display:inline-block;margin-top:10px;
             padding:8px 16px;
             background:#171a21;
             color:white;
             text-decoration:none;
             border-radius:6px;
             font-size:14px;">
             View on Steam
          </a>
        </td>
      </tr>
    `
    )
    .join("");

  const html = `
  <div style="font-family:Arial,sans-serif;background:#f4f6f8;padding:30px;">
    <table width="100%" style="max-width:600px;margin:auto;background:white;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="background:#171a21;color:white;padding:20px;text-align:center;">
          <h2 style="margin:0;"> Steam Price Alerts</h2>
          <p style="margin:6px 0 0 0;font-size:14px;">
            ${discountedGames.length} game(s) matched your target
          </p>
        </td>
      </tr>
      ${gameCards}
      <tr>
        <td style="padding:15px;text-align:center;font-size:12px;color:#888;">
          Cooldown active for 5 days per game.
        </td>
      </tr>
    </table>
  </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "noreply@codeheroes.store",
      to: [ALERT_EMAIL],
      subject: ` ${discountedGames.length} Steam Game(s) On Sale!`,
      html,
    }),
  });

  return response.ok;
}