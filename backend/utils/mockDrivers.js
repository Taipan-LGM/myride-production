import dotenv from "dotenv";
import { db } from "../database.js";

dotenv.config();

function main() {
  const cityLat = 40.7128; // NYC default
  const cityLng = -74.006;

  const vehicleTypes = ["Auto", "Mini", "Sedan", "Bike"];
  const count = 8;

  // bcrypt hash for password "Driver12345!" with cost 10
  const passwordHash =
    "$2a$10$uSg3qV7Y2mKxj8hX2v7XzO5l4v8p2b2xWg3qY4d1yIhH1fJm0b2ZK";

  const insertUser = db.prepare(
    "INSERT INTO users (role, email, password_hash, name) VALUES ('driver', ?, ?, ?)"
  );

  const insertProfile = db.prepare(
    "INSERT INTO driver_profiles (user_id, license_plate, vehicle_type, photo_url, approval_status, online, lat, lng) VALUES (?, ?, ?, ?, 'approved', 1, ?, ?)"
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const email = `seed.driver${Date.now()}_${i}@myride.local`.toLowerCase();
      const name = `Seed Driver ${i + 1}`;
      const plate = `MYRIDE-${100 + i}`;
      const vt = vehicleTypes[i % vehicleTypes.length];
      const lat = cityLat + (Math.random() - 0.5) * 0.08;
      const lng = cityLng + (Math.random() - 0.5) * 0.08;

      const info = insertUser.run(email, passwordHash, name);
      const userId = Number(info.lastInsertRowid);

      insertProfile.run(userId, plate, vt, null, lat, lng);
    }
  });

  tx();

  // eslint-disable-next-line no-console
  console.log(`Seeded ${count} mock drivers (password: Driver12345!)`);
}

main();

