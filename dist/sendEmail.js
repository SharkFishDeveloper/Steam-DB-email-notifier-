"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
function sendEmail(discountedGames, RESEND_API_KEY, ALERT_EMAIL) {
    return __awaiter(this, void 0, void 0, function* () {
        const targetGames = discountedGames.filter((g) => { var _a; return (_a = g.reasons) === null || _a === void 0 ? void 0 : _a.includes("target_reached"); });
        const dropGames = discountedGames.filter((g) => {
            var _a, _b;
            return ((_a = g.reasons) === null || _a === void 0 ? void 0 : _a.includes("price_dropped")) &&
                !((_b = g.reasons) === null || _b === void 0 ? void 0 : _b.includes("target_reached"));
        });
        function badge(label, color) {
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
        function gameCard(game) {
            var _a, _b;
            const isTarget = (_a = game.reasons) === null || _a === void 0 ? void 0 : _a.includes("target_reached");
            const isDrop = (_b = game.reasons) === null || _b === void 0 ? void 0 : _b.includes("price_dropped");
            const badgeHtml = isTarget
                ? badge("🎯 TARGET REACHED", "#4CAF50")
                : badge("📉 PRICE DROPPED", "#2196F3");
            const priceDropLine = isDrop && game.previousPrice !== undefined
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
            const currentLine = !isDrop || isTarget
                ? `<p style="margin:4px 0;">
             <span style="font-weight:bold;">Current Price:</span> ₹${game.currentPrice}
             ${game.discount
                    ? `<span style="color:#c7553e;margin-left:6px;font-size:13px;">${game.discount}% OFF</span>`
                    : ""}
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
        function sectionHeader(title) {
            return `
      <tr>
        <td style="padding:14px 20px 4px 20px;background:#f4f6f8;">
          <p style="margin:0;font-size:13px;font-weight:bold;color:#555;text-transform:uppercase;letter-spacing:1px;">
            ${title}
          </p>
        </td>
      </tr>`;
        }
        const targetSection = targetGames.length > 0
            ? `${sectionHeader(`🎯 Hit Your Target — ${targetGames.length} game(s)`)}
         ${targetGames.map(gameCard).join("")}`
            : "";
        const dropSection = dropGames.length > 0
            ? `${sectionHeader(`📉 Price Dropped — ${dropGames.length} game(s)`)}
         ${dropGames.map(gameCard).join("")}`
            : "";
        const totalCount = discountedGames.length;
        const subjectParts = [];
        if (targetGames.length)
            subjectParts.push(`${targetGames.length} hit target`);
        if (dropGames.length)
            subjectParts.push(`${dropGames.length} price drop`);
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
        const response = yield fetch("https://api.resend.com/emails", {
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
    });
}
exports.sendEmail = sendEmail;
