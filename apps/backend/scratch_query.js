const { Pool } = require('pg');

const renderDbUrl = 'postgresql://pestrack:By5dm8NUfvCCLh4okoLXpPQwjST0Ry4y@dpg-d93oqbbtqb8s73em4730-a.oregon-postgres.render.com:5432/pestrackdb';

const pool = new Pool({
  connectionString: renderDbUrl,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const makadiSiteId = 'e1c3fedf-a70e-42df-8c0a-8f467ee2e124';
    const { rows: locations } = await pool.query(
      `SELECT l.id, l.lat, l.lng, l.parcel_id, p.parcel_name 
       FROM locations l 
       LEFT JOIN parcels p ON l.parcel_id = p.id 
       WHERE l.site_id = $1;`,
      [makadiSiteId]
    );
    console.log("Locations on Makadi Heights (Production):", locations);

    const { rows: parcels } = await pool.query(
      `SELECT id, parcel_name, quadrant, lat, lng FROM parcels WHERE site_id = $1;`,
      [makadiSiteId]
    );
    console.log("\nParcels on Makadi Heights (Production):", parcels);
  } catch(e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
}
run();
