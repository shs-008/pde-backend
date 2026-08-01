/**
 * 🚀 خادم وسيط (Backend Proxy) لمحرك القرار الذكي PDE
 * الغرض الوحيد: تجاوز قيود CORS + إخفاء مفاتيح API عن المتصفح
 *
 * يستخدم fetch المدمج في Node.js 18+ (لا حاجة لـ axios)
 */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // يسمح لصفحة HTML بالاتصال بهذا الخادم من أي أصل
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ========== المفاتيح تُقرأ من متغيرات البيئة (لا تُكتب هنا أبداً) ==========
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';

// ========== خرائط الدوريات (نفس الخرائط الموجودة في الواجهة الأمامية) ==========
const ODDS_SPORT_KEYS = {
    England: 'soccer_epl', Spain: 'soccer_spain_la_liga', Italy: 'soccer_italy_serie_a',
    Germany: 'soccer_germany_bundesliga', France: 'soccer_france_ligue_one',
    Portugal: 'soccer_portugal_primeira_liga', Netherlands: 'soccer_netherlands_eredivisie',
    SaudiArabia: 'soccer_saudi_professional_league', Japan: 'soccer_japan_j_league',
    SouthKorea: 'soccer_south_korea_k_league_1', USA: 'soccer_usa_mls',
    Brazil: 'soccer_brazil_campeonato_brasileiro', Mexico: 'soccer_mexico_liga_mx'
};

const FOOTBALL_LEAGUE_IDS = {
    England: 39, Spain: 140, Italy: 135, Germany: 78, France: 61, Portugal: 94,
    Netherlands: 88, Belgium: 144, Turkey: 203, Scotland: 179, Greece: 197,
    Switzerland: 207, Austria: 218, Russia: 235, SaudiArabia: 307, Japan: 98,
    UAE: 301, Qatar: 305, Egypt: 233, SouthKorea: 292, China: 169, Morocco: 200,
    Algeria: 186, Tunisia: 202, SouthAfrica: 288, USA: 253, Brazil: 71,
    Argentina: 128, Mexico: 262, Colombia: 239, Chile: 265, Australia: 188
};

// ========== نقطة فحص الصحة ==========
app.get('/', (req, res) => {
    res.json({
        status: 'يعمل ✅',
        oddsApiConfigured: Boolean(ODDS_API_KEY),
        footballApiConfigured: Boolean(FOOTBALL_API_KEY),
        endpoints: ['/api/odds/:country', '/api/football-standings/:country']
    });
});

// ========== 1) وسيط The-Odds-API: أسماء الأندية + الكوطي الحقيقي ==========
app.get('/api/odds/:country', async (req, res) => {
    const { country } = req.params;
    const sportKey = ODDS_SPORT_KEYS[country];

    if (!sportKey) {
        return res.status(400).json({ error: `الدولة "${country}" غير مدعومة في The-Odds-API` });
    }
    if (!ODDS_API_KEY) {
        return res.status(500).json({ error: 'ODDS_API_KEY غير معرّف في متغيرات البيئة على الخادم' });
    }

    try {
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`;
        const response = await fetch(url);
        const remaining = response.headers.get('x-requests-remaining');

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: `The-Odds-API رفض الطلب: ${errText}` });
        }

        const data = await response.json();
        res.json({ matches: data, requestsRemaining: remaining });
    } catch (error) {
        res.status(502).json({ error: `فشل الاتصال بـ The-Odds-API: ${error.message}` });
    }
});

// ========== 2) وسيط API-Football: ترتيب حقيقي وتقييمات ==========
app.get('/api/football-standings/:country', async (req, res) => {
    const { country } = req.params;
    const leagueId = FOOTBALL_LEAGUE_IDS[country];

    if (!leagueId) {
        return res.status(400).json({ error: `الدولة "${country}" غير مدعومة في API-Football` });
    }
    if (!FOOTBALL_API_KEY) {
        return res.status(500).json({ error: 'FOOTBALL_API_KEY غير معرّف في متغيرات البيئة على الخادم' });
    }

    const now = new Date();
    const seasons = [now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1];
    seasons.push(seasons[0] - 1);

    for (const season of seasons) {
        try {
            const url = `https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`;
            const response = await fetch(url, { headers: { 'x-apisports-key': FOOTBALL_API_KEY } });

            if (!response.ok) continue;

            const data = await response.json();
            const block = data.response?.[0]?.league?.standings?.[0];
            if (!block || block.length === 0) continue;

            const teams = block.map(entry => ({
                name: entry.team.name,
                rating: Math.round(1500 + (entry.points / (entry.all.played || 1)) * 150 - (entry.rank * 5)),
                xg: Math.max(0.5, +((entry.all.goals.for || 0) / (entry.all.played || 1)).toFixed(2)),
                realStats: {
                    rank: entry.rank, points: entry.points, played: entry.all.played,
                    won: entry.all.win, drawn: entry.all.draw, lost: entry.all.lose,
                    goalsFor: entry.all.goals.for, goalsAgainst: entry.all.goals.against
                }
            }));

            return res.json({ teams, season });
        } catch (error) {
            return res.status(502).json({ error: `فشل الاتصال بـ API-Football: ${error.message}` });
        }
    }

    res.status(404).json({ error: 'لا توجد بيانات ترتيب متاحة (تحقق من الموسم أو المفتاح)' });
});

app.listen(PORT, () => {
    console.log(`🚀 الخادم الوسيط يعمل على المنفذ ${PORT}`);
    console.log(`   ODDS_API_KEY: ${ODDS_API_KEY ? 'مُعرّف ✅' : 'غير مُعرّف ❌'}`);
    console.log(`   FOOTBALL_API_KEY: ${FOOTBALL_API_KEY ? 'مُعرّف ✅' : 'غير مُعرّف ❌'}`);
});

module.exports = app;
