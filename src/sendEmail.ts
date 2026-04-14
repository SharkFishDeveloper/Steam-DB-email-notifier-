import { EmailGame } from ".";

type Game = {
  id: string | number;
  name: string;
  type: string;
  currentPrice: number;
  previousPrice?: number;
  targetPrice?: number;
  discount?: number;
  reasons?: string[];
};


export async function sendEmail(
  discountedGames: EmailGame[],
  RESEND_API_KEY: string,
  ALERT_EMAIL: string
): Promise<boolean> {

  const targetGames = discountedGames.filter((g) =>
    g.reasons?.includes("target_reached")
  );

  const dropGames = discountedGames.filter(
    (g) =>
      g.reasons?.includes("price_dropped") &&
      !g.reasons?.includes("target_reached")
  );

  function badge(label: string, color: string): string {
    return `<span style="
      display:inline-block;
      padding:3px 10px;
      border-radius:20px;
      font-size:11px;
      font-weight:bold;
      letter-spacing:0.5px;
      background:${color};
      color:white;
      margin-bottom:10px;
    ">${label}</span>`;
  }

  function gameCard(game: Game): string {
    const isTarget = game.reasons?.includes("target_reached");
    const isDrop = game.reasons?.includes("price_dropped");

    const badgeHtml = isTarget
      ? badge("🎯 TARGET REACHED", "#4CAF50")
      : badge("📉 PRICE DROPPED", "#2196F3");

    const priceDropLine =
      isDrop && game.previousPrice !== undefined
        ? `<p style="margin:4px 0;color:#2196F3;">
            <span style="font-weight:bold;">Previous:</span>
            <span style="text-decoration:line-through;color:#999;">₹${game.previousPrice}</span>
            → <span style="font-weight:bold;color:#2196F3;">₹${game.currentPrice}</span>
            <span style="font-size:12px;color:#2196F3;">
              (−₹${(game.previousPrice - game.currentPrice).toFixed(2)})
            </span>
          </p>`
        : "";

    const targetLine = isTarget && game.targetPrice !== undefined
      ? `<p style="margin:4px 0;">
           <span style="font-weight:bold;">Your Target:</span>
           <span style="color:#4CAF50;font-weight:bold;">₹${game.targetPrice}</span>
         </p>`
      : "";

    const currentLine =
      !isDrop || isTarget
        ? `<p style="margin:4px 0;">
             <span style="font-weight:bold;">Current Price:</span> ₹${game.currentPrice}
             ${
               game.discount
                 ? `<span style="color:#c7553e;margin-left:6px;font-size:13px;">${game.discount}% OFF</span>`
                 : ""
             }
           </p>`
        : "";

    return `
      <tr>
        <td style="padding:20px;border-bottom:1px solid #eee;">
          ${badgeHtml}
          <h3 style="margin:0 0 10px 0;color:#1b2838;">${game.name}</h3>
          ${priceDropLine}
          ${currentLine}
          ${targetLine}
          <a href="https://store.steampowered.com/${game.type}/${game.id}"
             style="display:inline-block;margin-top:12px;
             padding:8px 16px;
             background:#171a21;
             color:white;
             text-decoration:none;
             border-radius:6px;
             font-size:14px;">
             View on Steam →
          </a>
        </td>
      </tr>`;
  }

  function sectionHeader(title: string): string {
    return `
      <tr>
        <td style="padding:14px 20px 4px 20px;background:#f4f6f8;">
          <p style="margin:0;font-size:13px;font-weight:bold;color:#555;text-transform:uppercase;letter-spacing:1px;">
            ${title}
          </p>
        </td>
      </tr>`;
  }

  const targetSection =
    targetGames.length > 0
      ? `${sectionHeader(`🎯 Hit Your Target — ${targetGames.length} game(s)`)}
         ${targetGames.map(gameCard).join("")}`
      : "";

  const dropSection =
    dropGames.length > 0
      ? `${sectionHeader(`📉 Price Dropped — ${dropGames.length} game(s)`)}
         ${dropGames.map(gameCard).join("")}`
      : "";

  const totalCount = discountedGames.length;

  const subjectParts: string[] = [];
  if (targetGames.length) subjectParts.push(`${targetGames.length} hit target`);
  if (dropGames.length) subjectParts.push(`${dropGames.length} price drop`);

  const subject = `🎮 Steam Alert: ${subjectParts.join(" · ")}`;

  const html = `
  <div style="font-family:Arial,sans-serif;background:#f4f6f8;padding:30px;">
    <table width="100%" style="max-width:600px;margin:auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:#171a21;color:white;padding:24px;text-align:center;">
          <h2 style="margin:0;font-size:22px;">🎮 Steam Price Alerts</h2>
          <p style="margin:8px 0 0 0;font-size:14px;opacity:0.8;">
            ${totalCount} game(s) need your attention
          </p>
        </td>
      </tr>

      ${targetSection}
      ${dropSection}

      <tr>
        <td style="padding:16px;text-align:center;font-size:12px;color:#aaa;background:#fafafa;">
          Email cooldown active · 5 days per game
        </td>
      </tr>
    </table>
  </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "noreply@codeheroes.store",
      to: [ALERT_EMAIL],
      subject,
      html,
    }),
  });

  return response.ok;
}