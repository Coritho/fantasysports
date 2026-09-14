const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

exports.testNFLData = onRequest(async (req, res) => {
    try {
        const url =
            "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.parquet";

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(
                `NFLverse returned ${response.status} ${response.statusText}`
            );
        }

        const data = await response.arrayBuffer();

        res.json({
            success: true,
            message: "NFLverse connection works!",
            bytesDownloaded: data.byteLength
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});