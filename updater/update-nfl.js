/**
 * NFLVERSE -> FIREBASE CURRENT PLAYER DATABASE
 *
 * Downloads:
 *   1. NFLverse players.csv
 *   2. NFLverse roster_2026.csv
 *   3. NFLverse stats_player_reg_2026.csv
 *
 * ONLY CURRENT 2026 NFL ROSTER PLAYERS ARE STORED.
 *
 * Firestore collection:
 *   nflPlayers
 *
 * Document ID:
 *   NFLverse player_id
 *
 * IMPORTANT:
 * This stores RAW NFL statistics rather than relying on
 * NFLverse fantasy_points fields.
 *
 * This allows the website to calculate custom fantasy
 * scoring for each league.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const admin = require("firebase-admin");

const SEASON = 2026;

const FIREBASE_PROJECT_ID = "fantasy-sports-101";

const COLLECTION = "nflPlayers";

const DATA_DIR = path.join(__dirname, "data");

const PLAYERS_FILE =
  path.join(DATA_DIR, `players_${SEASON}.csv`);

const ROSTER_FILE =
  path.join(DATA_DIR, `roster_${SEASON}.csv`);

const STATS_FILE =
  path.join(DATA_DIR, `stats_player_reg_${SEASON}.csv`);

const PLAYERS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";

const ROSTER_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${SEASON}.csv`;

const STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${SEASON}.csv`;


console.log("");
console.log("==========================================");
console.log("NFLVERSE -> FIREBASE CURRENT PLAYER UPDATE");
console.log("==========================================");
console.log("");
console.log(`Season: ${SEASON}`);
console.log(`Firebase project: ${FIREBASE_PROJECT_ID}`);
console.log(`Firestore collection: ${COLLECTION}`);
console.log("");


// ============================================================
// FIREBASE
// ============================================================

function initializeFirebase() {
  console.log("Initializing Firebase...");

  if (!admin.apps.length) {
    const serviceAccountPath = path.join(
      __dirname,
      "firebase-service-account.json",
    );

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `Missing Firebase service account file:\n${serviceAccountPath}`,
      );
    }

    const serviceAccount =
      JSON.parse(
        fs.readFileSync(
          serviceAccountPath,
          "utf8",
        ),
      );

    admin.initializeApp({
      credential: admin.credential.cert(
        serviceAccount,
      ),
      projectId: FIREBASE_PROJECT_ID,
    });
  }

  console.log(
    `Firebase project: ${FIREBASE_PROJECT_ID}`,
  );

  return admin.firestore();
}


// ============================================================
// DOWNLOAD
// ============================================================

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    console.log("");
    console.log(`Downloading: ${url}`);

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "fantasy-sports-updater",
        },
      },
      (response) => {
        // ----------------------------------------------------
        // REDIRECT
        // ----------------------------------------------------

        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          downloadFile(
            response.headers.location,
            destination,
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        // ----------------------------------------------------
        // HTTP ERROR
        // ----------------------------------------------------

        if (response.statusCode !== 200) {
          response.resume();

          reject(
            new Error(
              `Download failed with HTTP ${response.statusCode}`,
            ),
          );

          return;
        }

        // ----------------------------------------------------
        // WRITE FILE
        // ----------------------------------------------------

        const file =
          fs.createWriteStream(destination);

        response.pipe(file);

        file.on("finish", () => {
          file.close(() => {
            console.log(
              `Downloaded: ${path.basename(destination)}`,
            );

            resolve();
          });
        });

        file.on("error", (error) => {
          try {
            fs.unlinkSync(destination);
          } catch (unlinkError) {
            // Ignore.
          }

          reject(error);
        });
      },
    );

    request.on("error", (error) => {
      try {
        fs.unlinkSync(destination);
      } catch (unlinkError) {
        // Ignore.
      }

      reject(error);
    });
  });
}


// ============================================================
// CSV PARSER
// ============================================================

function parseCSVLine(line) {
  const result = [];

  let current = "";

  let insideQuotes = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const character = line[i];

    if (character === '"') {
      if (
        insideQuotes &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        insideQuotes =
          !insideQuotes;
      }

      continue;
    }

    if (
      character === "," &&
      !insideQuotes
    ) {
      result.push(current);

      current = "";

      continue;
    }

    current += character;
  }

  result.push(current);

  return result;
}


function parseCSV(filePath) {
  console.log(
    `Reading ${path.basename(filePath)}...`,
  );

  const text =
    fs.readFileSync(
      filePath,
      "utf8",
    );

  const lines =
    text
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim() !== "",
      );

  if (lines.length < 2) {
    return [];
  }

  const headers =
    parseCSVLine(lines[0]).map(
      (header) =>
        header.trim(),
    );

  const rows = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const values =
      parseCSVLine(lines[i]);

    const row = {};

    for (
      let j = 0;
      j < headers.length;
      j++
    ) {
      row[headers[j]] =
        values[j] === undefined
          ? ""
          : values[j];
    }

    rows.push(row);
  }

  console.log(
    `Rows loaded: ${rows.length.toLocaleString()}`,
  );

  return rows;
}


// ============================================================
// HELPERS
// ============================================================

function firstValue(object, fields) {
  for (const field of fields) {
    if (
      object[field] !== undefined &&
      object[field] !== null &&
      String(object[field]).trim() !== ""
    ) {
      return String(
        object[field],
      ).trim();
    }
  }

  return "";
}


function numberValue(value) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return 0;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


function integerValue(value) {
  return Math.trunc(
    numberValue(value),
  );
}


function normalizeId(value) {
  return String(
    value || "",
  ).trim();
}


// ============================================================
// BUILD PLAYER INDEX
// ============================================================

function buildPlayerIndex(players) {
  console.log("");
  console.log("Indexing player database...");

  const index = new Map();

  for (const player of players) {
    const id =
      normalizeId(
        firstValue(
          player,
          [
            "gsis_id",
            "player_id",
            "id",
          ],
        ),
      );

    if (!id) {
      continue;
    }

    index.set(
      id,
      player,
    );
  }

  console.log(
    `Player records indexed: ${index.size.toLocaleString()}`,
  );

  return index;
}


// ============================================================
// BUILD ROSTER INDEX
// ============================================================

function buildRosterIndex(roster) {
  console.log("");
  console.log(
    `Indexing ${SEASON} roster data...`,
  );

  const index = new Map();

  for (const player of roster) {
    const id =
      normalizeId(
        firstValue(
          player,
          [
            "gsis_id",
            "player_id",
            "id",
          ],
        ),
      );

    if (!id) {
      continue;
    }

    index.set(
      id,
      player,
    );
  }

  console.log(
    `Roster players indexed: ${index.size.toLocaleString()}`,
  );

  return index;
}


// ============================================================
// BUILD STATS INDEX
// ============================================================

function buildStatsIndex(stats) {
  console.log("");
  console.log(
    `Indexing ${SEASON} regular-season stats...`,
  );

  const index = new Map();

  for (const stat of stats) {
    const id =
      normalizeId(
        firstValue(
          stat,
          [
            "player_id",
            "gsis_id",
          ],
        ),
      );

    if (!id) {
      continue;
    }

    /*
     * Some datasets can contain more than one
     * row for a player.
     *
     * Combine numeric statistics rather than
     * accidentally keeping only the final row.
     */

    if (!index.has(id)) {
      index.set(
        id,
        {
          ...stat,
        },
      );

      continue;
    }

    const existing =
      index.get(id);

    for (const [
      key,
      value,
    ] of Object.entries(stat)) {
      if (
        key === "player_id" ||
        key === "gsis_id"
      ) {
        continue;
      }

      const numeric =
        Number(value);

      if (
        Number.isFinite(numeric)
      ) {
        existing[key] =
          numberValue(
            existing[key],
          ) + numeric;
      } else if (
        !existing[key]
      ) {
        existing[key] = value;
      }
    }
  }

  console.log(
    `Players with ${SEASON} stats: ${index.size.toLocaleString()}`,
  );

  return index;
}


// ============================================================
// RAW STAT HELPER
// ============================================================

function statValue(stats, field) {
  return numberValue(
    stats[field],
  );
}


// ============================================================
// BUILD CURRENT PLAYERS
// ============================================================

function buildCurrentPlayers(
  playerIndex,
  rosterIndex,
  statsIndex,
) {
  console.log("");
  console.log(
    `Building FINAL CURRENT ${SEASON} player database...`,
  );

  const finalPlayers = [];

  /*
   * IMPORTANT:
   *
   * We loop through the ROSTER index.
   *
   * That means historical players from players.csv
   * are NOT uploaded.
   */

  for (
    const [
      id,
      rosterPlayer,
    ] of rosterIndex.entries()
  ) {
    const basePlayer =
      playerIndex.get(id) || {};

    const stats =
      statsIndex.get(id) || {};

    // --------------------------------------------------------
    // NAME
    // --------------------------------------------------------

    const playerName =
      firstValue(
        rosterPlayer,
        [
          "full_name",
          "player_name",
          "display_name",
        ],
      ) ||
      firstValue(
        basePlayer,
        [
          "display_name",
          "player_name",
          "full_name",
        ],
      ) ||
      "Unknown Player";

    const firstName =
      firstValue(
        rosterPlayer,
        [
          "first_name",
        ],
      ) ||
      firstValue(
        basePlayer,
        [
          "first_name",
        ],
      );

    const lastName =
      firstValue(
        rosterPlayer,
        [
          "last_name",
        ],
      ) ||
      firstValue(
        basePlayer,
        [
          "last_name",
        ],
      );

    // --------------------------------------------------------
    // POSITION
    // --------------------------------------------------------

    const position =
      firstValue(
        rosterPlayer,
        [
          "position",
        ],
      ) ||
      firstValue(
        basePlayer,
        [
          "position",
        ],
      ) ||
      "N/A";

    const positionGroup =
      firstValue(
        rosterPlayer,
        [
          "position_group",
        ],
      ) ||
      firstValue(
        basePlayer,
        [
          "position_group",
        ],
      ) ||
      position;

    // --------------------------------------------------------
    // TEAM
    // --------------------------------------------------------

    const team =
      firstValue(
        rosterPlayer,
        [
          "team",
          "team_abbr",
        ],
      ) ||
      firstValue(
        basePlayer,
        [
          "recent_team",
          "team",
          "team_abbr",
        ],
      ) ||
      "FA";

    // ========================================================
    // CREATE PLAYER RECORD
    // ========================================================

    const record = {
      // ------------------------------------------------------
      // IDENTITY
      // ------------------------------------------------------

      player_id: id,

      player_name: playerName,

      first_name: firstName,

      last_name: lastName,

      position: position,

      position_group: positionGroup,

      team: team,

      season: SEASON,

      // ------------------------------------------------------
      // ROSTER INFORMATION
      // ------------------------------------------------------

      jersey_number: integerValue(
        firstValue(
          rosterPlayer,
          [
            "jersey_number",
          ],
        ),
      ),

      status:
        firstValue(
          rosterPlayer,
          [
            "status",
            "status_description",
          ],
        ) || "Active",

      // ======================================================
      // PASSING
      // ======================================================

      passing: {
        attempts: statValue(
          stats,
          "attempts",
        ),

        completions: statValue(
          stats,
          "completions",
        ),

        passing_yards: statValue(
          stats,
          "passing_yards",
        ),

        passing_tds: statValue(
          stats,
          "passing_tds",
        ),

        interceptions: statValue(
          stats,
          "interceptions",
        ),

        sacks: statValue(
          stats,
          "sacks",
        ),

        sack_yards: statValue(
          stats,
          "sack_yards",
        ),

        passing_2pt_conversions:
          statValue(
            stats,
            "passing_2pt_conversions",
          ),
      },

      // ======================================================
      // RUSHING
      // ======================================================

      rushing: {
        carries: statValue(
          stats,
          "carries",
        ),

        rushing_yards: statValue(
          stats,
          "rushing_yards",
        ),

        rushing_tds: statValue(
          stats,
          "rushing_tds",
        ),

        rushing_2pt_conversions:
          statValue(
            stats,
            "rushing_2pt_conversions",
          ),
      },

      // ======================================================
      // RECEIVING
      // ======================================================

      receiving: {
        targets: statValue(
          stats,
          "targets",
        ),

        receptions: statValue(
          stats,
          "receptions",
        ),

        receiving_yards: statValue(
          stats,
          "receiving_yards",
        ),

        receiving_tds: statValue(
          stats,
          "receiving_tds",
        ),

        receiving_2pt_conversions:
          statValue(
            stats,
            "receiving_2pt_conversions",
          ),

        receiving_air_yards:
          statValue(
            stats,
            "receiving_air_yards",
          ),

        receiving_yac:
          statValue(
            stats,
            "receiving_yac",
          ),
      },

      // ======================================================
      // FUMBLES
      // ======================================================

      fumbles: {
        fumbles: statValue(
          stats,
          "rushing_fumbles",
        ) +
          statValue(
            stats,
            "receiving_fumbles",
          ),

        fumbles_lost:
          statValue(
            stats,
            "rushing_fumbles_lost",
          ) +
          statValue(
            stats,
            "receiving_fumbles_lost",
          ),
      },

      // ======================================================
      // DEFENSE
      // ======================================================

      defense: {
        tackles: statValue(
          stats,
          "def_tackles",
        ),

        solo_tackles: statValue(
          stats,
          "def_solo_tackles",
        ),

        assists: statValue(
          stats,
          "def_assists",
        ),

        sacks: statValue(
          stats,
          "def_sacks",
        ),

        tackles_for_loss:
          statValue(
            stats,
            "def_tackles_for_loss",
          ),

        quarterback_hits:
          statValue(
            stats,
            "def_qb_hits",
          ),

        interceptions:
          statValue(
            stats,
            "def_interceptions",
          ),

        interception_yards:
          statValue(
            stats,
            "def_interception_yards",
          ),

        interception_tds:
          statValue(
            stats,
            "def_interception_tds",
          ),

        passes_defended:
          statValue(
            stats,
            "def_pass_defended",
          ),

        forced_fumbles:
          statValue(
            stats,
            "def_forced_fumbles",
          ),

        fumble_recoveries:
          statValue(
            stats,
            "def_fumble_recoveries",
          ),

        fumble_recovery_yards:
          statValue(
            stats,
            "def_fumble_recovery_yards",
          ),

        fumble_recovery_tds:
          statValue(
            stats,
            "def_fumble_recovery_tds",
          ),
      },

      // ======================================================
      // KICKING
      // ======================================================

      kicking: {
        field_goal_attempts:
          statValue(
            stats,
            "fg_att",
          ),

        field_goals_made:
          statValue(
            stats,
            "fg_made",
          ),

        extra_point_attempts:
          statValue(
            stats,
            "pat_att",
          ),

        extra_points_made:
          statValue(
            stats,
            "pat_made",
          ),

        field_goal_long:
          statValue(
            stats,
            "fg_long",
          ),
      },

      // ======================================================
      // PUNTING
      // ======================================================

      punting: {
        punts: statValue(
          stats,
          "punts",
        ),

        punt_yards: statValue(
          stats,
          "punt_yards",
        ),

        punt_average:
          statValue(
            stats,
            "punt_avg",
          ),
      },

      // ======================================================
      // RETURNS
      // ======================================================

      returns: {
        punt_returns:
          statValue(
            stats,
            "punt_returns",
          ),

        punt_return_yards:
          statValue(
            stats,
            "punt_return_yards",
          ),

        punt_return_tds:
          statValue(
            stats,
            "punt_return_tds",
          ),

        kick_returns:
          statValue(
            stats,
            "kick_returns",
          ),

        kick_return_yards:
          statValue(
            stats,
            "kick_return_yards",
          ),

        kick_return_tds:
          statValue(
            stats,
            "kick_return_tds",
          ),
      },

      // ======================================================
      // SNAP / PLAY PARTICIPATION
      // ======================================================

      participation: {
        offensive_snaps:
          statValue(
            stats,
            "offense_snaps",
          ),

        defensive_snaps:
          statValue(
            stats,
            "defense_snaps",
          ),

        special_teams_snaps:
          statValue(
            stats,
            "special_teams_snaps",
          ),
      },

      // ======================================================
      // ORIGINAL NFLVERSE FANTASY VALUES
      // ======================================================
      //
      // Keep these for reference only.
      //
      // Our website will NOT have to use these.
      //

      nflverse_fantasy: {
        fantasy_points:
          statValue(
            stats,
            "fantasy_points",
          ),

        fantasy_points_ppr:
          statValue(
            stats,
            "fantasy_points_ppr",
          ),
      },

      // ======================================================
      // UPDATE
      // ======================================================

      updated_at:
        admin.firestore.FieldValue.serverTimestamp(),
    };

    finalPlayers.push(record);
  }

  console.log("");

  console.log(
    `CURRENT players: ${finalPlayers.length.toLocaleString()}`,
  );

  return finalPlayers;
}


// ============================================================
// DELETE OLD FIRESTORE PLAYERS
// ============================================================

async function deleteOldPlayers(
  db,
  currentIds,
) {
  console.log("");
  console.log(
    "Checking Firestore for old players...",
  );

  const collectionRef =
    db.collection(COLLECTION);

  const snapshot =
    await collectionRef.get();

  console.log(
    `Existing Firestore players: ${snapshot.size.toLocaleString()}`,
  );

  const toDelete = [];

  snapshot.forEach((doc) => {
    if (
      !currentIds.has(doc.id)
    ) {
      toDelete.push(
        doc.ref,
      );
    }
  });

  console.log(
    `Old players to remove: ${toDelete.length.toLocaleString()}`,
  );

  if (
    toDelete.length === 0
  ) {
    console.log(
      "No old players need to be removed.",
    );

    return;
  }

  console.log(
    "Deleting old players...",
  );

  const DELETE_BATCH_SIZE = 400;

  for (
    let start = 0;
    start < toDelete.length;
    start += DELETE_BATCH_SIZE
  ) {
    const batch =
      db.batch();

    const chunk =
      toDelete.slice(
        start,
        start + DELETE_BATCH_SIZE,
      );

    for (
      const ref of chunk
    ) {
      batch.delete(ref);
    }

    await batch.commit();

    const completed =
      Math.min(
        start + chunk.length,
        toDelete.length,
      );

    console.log(
      `Deleted ${completed.toLocaleString()} / ${toDelete.length.toLocaleString()}`,
    );
  }

  console.log(
    "Old players removed.",
  );
}


// ============================================================
// FIRESTORE UPLOAD
// ============================================================

async function uploadPlayers(
  db,
  players,
) {
  console.log("");

  console.log(
    `Uploading ${players.length.toLocaleString()} CURRENT players to Firestore...`,
  );

  /*
   * Firestore maximum:
   *
   * 500 writes per batch.
   *
   * Use 400 for safety.
   */

  const BATCH_SIZE = 400;

  let uploaded = 0;

  for (
    let start = 0;
    start < players.length;
    start += BATCH_SIZE
  ) {
    const batch =
      db.batch();

    const chunk =
      players.slice(
        start,
        start + BATCH_SIZE,
      );

    for (
      const player of chunk
    ) {
      const ref =
        db
          .collection(COLLECTION)
          .doc(
            player.player_id,
          );

      batch.set(
        ref,
        player,
        {
          merge: true,
        },
      );
    }

    await batch.commit();

    uploaded +=
      chunk.length;

    console.log(
      `Uploaded ${uploaded.toLocaleString()} / ${players.length.toLocaleString()}`,
    );
  }

  console.log("");

  console.log(
    "All current players uploaded.",
  );
}


// ============================================================
// MAIN
// ============================================================

async function main() {
  try {
    // --------------------------------------------------------
    // DATA DIRECTORY
    // --------------------------------------------------------

    if (
      !fs.existsSync(
        DATA_DIR,
      )
    ) {
      fs.mkdirSync(
        DATA_DIR,
        {
          recursive: true,
        },
      );
    }

    // --------------------------------------------------------
    // FIREBASE
    // --------------------------------------------------------

    const db =
      initializeFirebase();

    // --------------------------------------------------------
    // DOWNLOAD PLAYERS
    // --------------------------------------------------------

    console.log("");
    console.log(
      "Downloading NFL player information...",
    );

    await downloadFile(
      PLAYERS_URL,
      PLAYERS_FILE,
    );

    // --------------------------------------------------------
    // DOWNLOAD ROSTER
    // --------------------------------------------------------

    console.log("");
    console.log(
      `Downloading ${SEASON} roster information...`,
    );

    await downloadFile(
      ROSTER_URL,
      ROSTER_FILE,
    );

    // --------------------------------------------------------
    // DOWNLOAD STATS
    // --------------------------------------------------------

    console.log("");
    console.log(
      `Downloading ${SEASON} regular-season stats...`,
    );

    await downloadFile(
      STATS_URL,
      STATS_FILE,
    );

    // --------------------------------------------------------
    // READ PLAYERS
    // --------------------------------------------------------

    console.log("");
    console.log(
      "Reading player database...",
    );

    const players =
      parseCSV(
        PLAYERS_FILE,
      );

    // --------------------------------------------------------
    // READ ROSTER
    // --------------------------------------------------------

    console.log("");
    console.log(
      `Reading ${SEASON} roster database...`,
    );

    const roster =
      parseCSV(
        ROSTER_FILE,
      );

    // --------------------------------------------------------
    // READ STATS
    // --------------------------------------------------------

    console.log("");
    console.log(
      `Reading ${SEASON} stats...`,
    );

    const stats =
      parseCSV(
        STATS_FILE,
      );

    // --------------------------------------------------------
    // INDEX
    // --------------------------------------------------------

    const playerIndex =
      buildPlayerIndex(
        players,
      );

    const rosterIndex =
      buildRosterIndex(
        roster,
      );

    const statsIndex =
      buildStatsIndex(
        stats,
      );

    // --------------------------------------------------------
    // BUILD CURRENT DATABASE
    // --------------------------------------------------------

    const currentPlayers =
      buildCurrentPlayers(
        playerIndex,
        rosterIndex,
        statsIndex,
      );

    if (
      currentPlayers.length === 0
    ) {
      throw new Error(
        "No current players were found. Firestore was NOT modified.",
      );
    }

    // --------------------------------------------------------
    // CURRENT PLAYER IDS
    // --------------------------------------------------------

    const currentIds =
      new Set(
        currentPlayers.map(
          (player) =>
            player.player_id,
        ),
      );

    // --------------------------------------------------------
    // UPLOAD CURRENT PLAYERS
    // --------------------------------------------------------

    await uploadPlayers(
      db,
      currentPlayers,
    );

    // --------------------------------------------------------
    // DELETE OLD PLAYERS
    // --------------------------------------------------------

    await deleteOldPlayers(
      db,
      currentIds,
    );

    // --------------------------------------------------------
    // FINISHED
    // --------------------------------------------------------

    console.log("");

    console.log(
      "==========================================",
    );

    console.log(
      "NFL UPDATE COMPLETE",
    );

    console.log(
      "==========================================",
    );

    console.log("");

    console.log(
      `Season: ${SEASON}`,
    );

    console.log(
      `Current players: ${currentPlayers.length.toLocaleString()}`,
    );

    console.log(
      `Players with ${SEASON} stats: ${statsIndex.size.toLocaleString()}`,
    );

    console.log("");

    console.log(
      "Raw statistics are now available for custom fantasy scoring.",
    );

    console.log("");
  } catch (error) {
    console.error("");

    console.error(
      "==========================================",
    );

    console.error(
      "NFL UPDATE FAILED",
    );

    console.error(
      "==========================================",
    );

    console.error("");

    console.error(error);

    console.error("");

    process.exitCode = 1;
  }
}

main();