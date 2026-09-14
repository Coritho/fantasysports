const admin = require("firebase-admin");

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing.");
}

const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function downloadNFLData() {
    const year = new Date().getUTCFullYear();

    const url =
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.parquet`;

    console.log(`Downloading NFL data from nflverse...`);
    console.log(`URL: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `NFLverse returned ${response.status} ${response.statusText}`
        );
    }

    const buffer = await response.arrayBuffer();

    console.log(
        `Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`
    );

    /*
     * We'll add the Parquet reader here next.
     */

    console.log(`NFL season: ${year}`);
}

async function main() {
    try {
        await downloadNFLData();

        console.log("NFL update finished.");
    } catch (error) {
        console.error("NFL update failed:");
        console.error(error);

        process.exit(1);
    }
}

main();