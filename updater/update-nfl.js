const admin = require("firebase-admin");
const https = require("https");
const fs = require("fs");
const path = require("path");

const TEMP_FILE = path.join(__dirname, "player_stats.csv");

// nflverse CSV
const DATA_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv";

console.log("==========================================");
console.log("NFLVERSE → FIREBASE PLAYER UPDATE");
console.log("==========================================");

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    https.get(url, (response) => {
      // Follow redirects
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close();
        fs.unlinkSync(destination);

        return downloadFile(response.headers.location, destination)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destination);

        return reject(
          new Error(`Download failed with HTTP ${response.statusCode}`)
        );
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

function parseCSVLine(line) {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);

  return values;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

async function main() {
  try {
    console.log("");
    console.log("Initializing Firebase...");

    admin.initializeApp();

    const db = admin.firestore();

    console.log("Downloading current nflverse player statistics...");
    console.log(DATA_URL);

    await downloadFile(DATA_URL, TEMP_FILE);

    console.log("Download complete.");

    console.log("Reading CSV file...");

    const csvText = fs.readFileSync(TEMP_FILE, "utf8");

    const players = parseCSV(csvText);

    console.log(`Rows downloaded: ${players.length}`);

    if (players.length === 0) {
      throw new Error("The NFL data file contained no players.");
    }

    /*
     * Build a unique player database.
     *
     * player_stats contains weekly rows, so the same player can appear
     * many times. We only want one Firestore document per player.
     */

    const uniquePlayers = new Map();

    for (const player of players) {
      const playerId =
        player.player_id ||
        player.gsis_id ||
        player.display_name;

      if (!playerId) {
        continue;
      }

      if (!uniquePlayers.has(playerId)) {
        uniquePlayers.set(playerId, {
          player_id: playerId,
          player_name:
            player.player_display_name ||
            player.player_name ||
            player.display_name ||
            "Unknown",

          first_name: player.player_first_name || "",
          last_name: player.player_last_name || "",

          position: player.position || "",
          position_group: player.position_group || "",

          team:
            player.recent_team ||
            player.team ||
            "",

          season:
            player.season
              ? Number(player.season)
              : null,

          fantasy_points:
            player.fantasy_points
              ? Number(player.fantasy_points)
              : 0,

          fantasy_points_ppr:
            player.fantasy_points_ppr
              ? Number(player.fantasy_points_ppr)
              : 0,

          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    console.log(`Unique players found: ${uniquePlayers.size}`);

    if (uniquePlayers.size === 0) {
      throw new Error(
        "No unique players could be extracted from the NFL data."
      );
    }

    console.log("");
    console.log("Uploading players to Firestore...");

    const playerArray = Array.from(uniquePlayers.values());

    let batch = db.batch();
    let operations = 0;
    let batches = 0;

    for (const player of playerArray) {
      const docId = String(player.player_id);

      const ref = db.collection("players").doc(docId);

      batch.set(ref, player, {
        merge: true,
      });

      operations++;

      /*
       * Firestore batches have a 500-write limit.
       */
      if (operations >= 450) {
        await batch.commit();

        batches++;

        console.log(
          `Uploaded batch ${batches} (${operations} players)`
        );

        batch = db.batch();
        operations = 0;
      }
    }

    if (operations > 0) {
      await batch.commit();

      batches++;

      console.log(
        `Uploaded batch ${batches} (${operations} players)`
      );
    }

    console.log("");
    console.log("==========================================");
    console.log("NFL PLAYER UPDATE COMPLETE");
    console.log("==========================================");
    console.log(`Players uploaded: ${playerArray.length}`);
    console.log(`Firestore collection: players`);
    console.log("");

    if (fs.existsSync(TEMP_FILE)) {
      fs.unlinkSync(TEMP_FILE);
    }

  } catch (error) {
    console.error("");
    console.error("NFL UPDATE FAILED");
    console.error(error.message);
    console.error("");

    if (fs.existsSync(TEMP_FILE)) {
      fs.unlinkSync(TEMP_FILE);
    }

    process.exit(1);
  }
}

main();