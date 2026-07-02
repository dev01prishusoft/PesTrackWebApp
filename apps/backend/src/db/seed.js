/**
 * Idempotent seed: initial site, reference data, 44 El Gouna parcels,
 * and a bcrypt-hashed default admin assigned to the site via user_sites.
 * Safe to re-run (uses ON CONFLICT / existence checks).
 */
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
require('dotenv').config();

const PARCELS = [
  ['AS4', 27.429844, 33.654529, 'NW'], ['AS3', 27.428280, 33.659535, 'NW'],
  ['AS2', 27.423932, 33.659330, 'NW'], ['AS1', 27.417989, 33.661930, 'NW'],
  ['Fanadir Bay 2', 27.430220, 33.662351, 'NW'], ['Nines', 27.420732, 33.656251, 'NW'],
  ['North Bay', 27.429358, 33.649081, 'NW'], ['Ancient Hill', 27.421369, 33.652870, 'NW'],
  ['Fanadir Bay 1', 27.422167, 33.666699, 'NE'], ['Fanadir Lagoon', 27.416294, 33.668184, 'NE'],
  ['Fanadir Marina', 27.419112, 33.670189, 'NE'], ['Um Jummar', 27.412056, 33.669503, 'NE'],
  ['Mangroovy', 27.415959, 33.674517, 'NE'], ['New Marina', 27.411751, 33.676053, 'NE'],
  ['Fanadir Shore', 27.419644, 33.673575, 'NE'], ['Joubal 1', 27.409179, 33.671129, 'NE'],
  ['Joubal 2', 27.410130, 33.668415, 'NE'], ['Cyan the Range', 27.408812, 33.655498, 'SW'],
  ['Shedwan', 27.400256, 33.656584, 'SW'], ['Tawila', 27.402020, 33.661373, 'SW'],
  ['Swan Lake', 27.405161, 33.659119, 'SW'], ['Containers', 27.397179, 33.646260, 'SW'],
  ['Sholan 1', 27.395183, 33.650768, 'SW'], ['Sholan 2', 27.396049, 33.647897, 'SW'],
  ['Scarab', 27.393171, 33.648000, 'SW'], ['Bali', 27.390961, 33.647817, 'SW'],
  ['G Cribbs 1', 27.395471, 33.641827, 'SW'], ['G Cribbs 2', 27.394183, 33.642708, 'SW'],
  ['Toban', 27.396737, 33.665663, 'SW'], ['Siba', 27.414314, 33.653550, 'SW'],
  ['Encore', 27.399205, 33.649043, 'SW'], ['Abu Tig Marina', 27.408094, 33.676053, 'SE'],
  ['Abu Tig Hill', 27.409776, 33.674420, 'SE'], ['Cyan', 27.407449, 33.663410, 'SE'],
  ['Upper Nubian', 27.405485, 33.670256, 'SE'], ['Nubian Village', 27.399229, 33.677050, 'SE'],
  ['New Nubia', 27.404607, 33.674670, 'SE'], ['South Marina', 27.401498, 33.670980, 'SE'],
  ['Downtown', 27.396398, 33.674196, 'SE'], ['Hill Villas', 27.397253, 33.682278, 'SE'],
  ['North Golf', 27.393594, 33.671179, 'SE'], ['Zerzera', 27.402145, 33.666806, 'SE'],
  ['Festival Plaza', 27.403971, 33.668101, 'SE'], ['Art Island', 27.406677, 33.667668, 'SE'],
];

const CATEGORIES = [
  ['STP / Trenches', '#1D4ED8', 1],
  ['Exposed Waste', '#78350F', 2],
  ['Dysfunctional Swim Pool', '#6B7280', 3],
  ['Structural', '#7C3AED', 4],
  ['Landscape/Irrigation', '#15803D', 5],
  ['Construction Debris', '#92400E', 6],
  ['Drains & Manholes', '#0E7490', 7],
  ['Other', '#374151', 8],
];

const STATUSES = [
  ['1st Offense', '#FB923C', '🟠', 1],
  ['Repeat', '#EF4444', '🔴', 2],
  ['Resolved', '#22C55E', '🟢', 3],
];

const ESCALATIONS = [
  ['Not assigned', 0], ['SOTAICO', 1], ['Client QA', 2], ['Client FM', 3],
  ['Client Subcontractor RS', 4], ['Client Subcontractor OC', 5],
  ['Client Subcontractor Other', 6], ['Client Senior Management', 7], ['Other', 8],
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Initial site
    const site = await client.query(
      `INSERT INTO sites (name, slug, map_center_lat, map_center_lng, default_zoom)
       VALUES ('El Gouna', 'el-gouna', 27.3949, 33.6782, 14)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const siteId = site.rows[0].id;

    // 2. Reference data
    for (const [label, color, sort] of CATEGORIES) {
      await client.query(
        `INSERT INTO categories (label, color, sort_order) VALUES ($1,$2,$3)
         ON CONFLICT (label) DO UPDATE SET color=EXCLUDED.color, sort_order=EXCLUDED.sort_order`,
        [label, color, sort]
      );
    }
    for (const [label, color, emoji, sort] of STATUSES) {
      await client.query(
        `INSERT INTO statuses (label, color, emoji, sort_order) VALUES ($1,$2,$3,$4)
         ON CONFLICT (label) DO UPDATE SET color=EXCLUDED.color, emoji=EXCLUDED.emoji, sort_order=EXCLUDED.sort_order`,
        [label, color, emoji, sort]
      );
    }
    for (const [label, sort] of ESCALATIONS) {
      await client.query(
        `INSERT INTO escalation_options (label, sort_order) VALUES ($1,$2)
         ON CONFLICT (label) DO UPDATE SET sort_order=EXCLUDED.sort_order`,
        [label, sort]
      );
    }

    // 3. Parcels
    for (const [name, lat, lng, quadrant] of PARCELS) {
      await client.query(
        `INSERT INTO parcels (site_id, parcel_name, lat, lng, quadrant) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (site_id, parcel_name) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, quadrant=EXCLUDED.quadrant`,
        [siteId, name, lat, lng, quadrant]
      );
    }

    // 4. Default admin (bcrypt-hashed) + site assignment
    const username = process.env.ADMIN_USERNAME || 'admin';
    const email = process.env.ADMIN_EMAIL || 'admin@sotaico.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin@123';
    const hash = await bcrypt.hash(password, 12);

    const admin = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'System Administrator', 'admin')
       ON CONFLICT (username) DO UPDATE SET email=EXCLUDED.email
       RETURNING id`,
      [username, email, hash]
    );
    const adminId = admin.rows[0].id;

    await client.query(
      `INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2)
       ON CONFLICT (user_id, site_id) DO NOTHING`,
      [adminId, siteId]
    );

    await client.query('COMMIT');
    console.log(`Seed complete. Site id=${siteId}, admin id=${adminId} (username="${username}").`);
    console.log(`Parcels: ${PARCELS.length}, categories: ${CATEGORIES.length}, statuses: ${STATUSES.length}, escalations: ${ESCALATIONS.length}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}

module.exports = { seed };
