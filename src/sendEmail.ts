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
  try {
    // ================= VALIDATION =================
    if (!RESEND_API_KEY) {
      console.error("❌ Missing RESEND_API_KEY");
      return false;
    }

    if (!ALERT_EMAIL) {
      console.error("❌ Missing ALERT_EMAIL");
      return false;
    }

    if (!discountedGames || discountedGames.length === 0) {
      console.warn("⚠️ No games to send email for");
      return false;
    }

    console.log("📦 Total discounted games:", discountedGames.length);

    // ================= FILTER =================
    const targetGames = discountedGames.filter((g) =>
      g.reasons?.includes("target_reached")
    );

    const dropGames = discountedGames.filter(
      (g) =>
        g.reasons?.includes("price_dropped") &&
        !g.reasons?.includes("target_reached")
    );

    console.log("🎯 Target games:", targetGames.length);
    console.log("📉 Drop games:", dropGames.length);

    // ================= HELPERS =================
    function badge(label: string, color: string): string {
      return `<span style="
        display:inline-block;
        padding:3px 10px;
        border-radius:20px;
        font-size:11px;
        font-weight:bold;
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
          ? `<p>
              Previous: <s>₹${game.previousPrice}</s> → 
              <b>₹${game.currentPrice}</b>
              (−₹${(game.previousPrice - game.currentPrice).toFixed(2)})
            </p>`
          : "";

      const targetLine =
        isTarget && game.targetPrice !== undefined
          ? `<p>Your Target: <b>₹${game.targetPrice}</b></p>`
          : "";

      const currentLine = `<p>
        Current Price: ₹${game.currentPrice}
        ${
          game.discount
            ? `<span style="color:red;"> ${game.discount}% OFF</span>`
            : ""
        }
      </p>`;

      return `
        <tr>
          <td style="padding:15px;border-bottom:1px solid #eee;">
            ${badgeHtml}
            <h3>${game.name}</h3>
            ${priceDropLine}
            ${currentLine}
            ${targetLine}
            <a href="https://store.steampowered.com/${game.type}/${game.id}">
              View Game →
            </a>
          </td>
        </tr>`;
    }

    function sectionHeader(title: string): string {
      return `
        <tr>
          <td style="padding:10px;background:#f4f6f8;">
            <b>${title}</b>
          </td>
        </tr>`;
    }

    // ================= SECTIONS =================
    const targetSection =
      targetGames.length > 0
        ? `${sectionHeader(`🎯 Target Hit (${targetGames.length})`)}
           ${targetGames.map(gameCard).join("")}`
        : "";

    const dropSection =
      dropGames.length > 0
        ? `${sectionHeader(`📉 Price Drop (${dropGames.length})`)}
           ${dropGames.map(gameCard).join("")}`
        : "";

    // ================= SUBJECT =================
    const subjectParts: string[] = [];

    if (targetGames.length)
      subjectParts.push(`${targetGames.length} target hit`);
    if (dropGames.length)
      subjectParts.push(`${dropGames.length} price drop`);

    const subject =
      subjectParts.length > 0
        ? `🎮 Steam Alert: ${subjectParts.join(" · ")}`
        : "🎮 Steam Alert: Updates Available";

    console.log("📧 Subject:", subject);

    // ================= HTML =================
    const html = `
    <div style="font-family:Arial;padding:20px;background:#f4f6f8;">
      <table style="max-width:600px;margin:auto;background:white;">
        <tr>
          <td style="background:#171a21;color:white;padding:20px;text-align:center;">
            <h2>Steam Alerts</h2>
          </td>
        </tr>

        ${targetSection}
        ${dropSection}

        <tr>
          <td style="text-align:center;font-size:12px;color:#999;">
            Email cooldown active
          </td>
        </tr>
      </table>
    </div>`;

    // ================= API CALL =================
    console.log("🚀 Sending email...");

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

    const data = await response.text();

    console.log("📨 Response status:", response.status);
    console.log("📨 Response body:", data);

    if (!response.ok) {
      console.error("❌ Email sending failed");
      return false;
    }

    console.log("✅ Email sent successfully!");
    return true;
  } catch (error) {
    console.error("🔥 Unexpected error:", error);
    return false;
  }
}