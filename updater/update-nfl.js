const admin = require("firebase-admin");
const parquet = require("parquetjs-lite");
const fs = require("fs");
const https = require("https");

const DATA_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.parquet";

const DATA_FILE = "/tmp/player_stats.parquet";

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    https.get(url, (response) => {
      // Follow GitHub's redirect.
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close();
        fs.unlinkSync(destination);

        downloadFile(response.headers.location, destination)
          .then(resolve)
          .catch(reject);

        return;
      }

      if (response.statusCode !== 200) {
        reject(
          new Error(`Download failed with HTTP ${response.statusCode}`)
        );
        return;
      }

      response.pipe(file);

      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", (error) => {
      file.close();

      if (fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }

      reject(error);
    });
  });
}

function cleanValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }

  return value;
}

async function main() {
  console.log("==========================================");
  console.log("NFLVERSE → FIREBASE PLAYER UPDATE");
  console.log("==========================================");

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT GitHub secret is missing."
    );
  }

  console.log("Initializing Firebase...");

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const db = admin.firestore();

  console.log("Downloading current nflverse player statistics...");
  console.log(DATA_URL);

  await downloadFile(DATA_URL, DATA_FILE);

  console.log("Download complete.");
  console.log("Reading Parquet file...");

  const reader = await parquet.ParquetReader.openFile(DATA_FILE);

  const cursor = reader.getCursor();

  let row;
  let count = 0;
  let batch = db.batch();
  let batchCount = 0;

  while ((row = await cursor.next())) {
    /*
     * Use player_id as the Firestore document ID whenever available.
     * That means a player gets updated instead of duplicated.
     */
    const playerId =
      row.player_id ||
      row.gsis_id ||
      row.display_name;

    if (!playerId) {
      continue;
    }

    const player = {};

    for (const [key, value] of Object.entries(row)) {
      player[key] = cleanValue(value);
    }

    player.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const ref = db
      .collection("nflPlayers")
      .doc(String(playerId));

    batch.set(ref, player, {merge: true});

    count++;
    batchCount++;

    /*
     * Firestore batches have a 500-operation limit.
     * Keep a little room below that limit.
     */
    if (batchCount >= 450) {
      await batch.commit();

      console.log(`Uploaded ${count} players...`);

      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  await reader.close();

  fs.unlinkSync(DATA_FILE);

  console.log("------------------------------------------");
  console.log(`Finished. Processed ${count} player records.`);
  console.log("Firestore collection: nflPlayers");
  console.log("------------------------------------------");
}

main().catch((error) => {
  console.error("NFL UPDATE FAILED");
  console.error(error);
  process.exit(1);
});