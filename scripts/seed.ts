import dotenv from 'dotenv';

dotenv.config();

const API_URL = `http://localhost:${process.env.PORT || 8080}`;

const users = [
  {
    email: 'alice@example.com',
    password: 'password123',
    username: 'alice_wonder',
  },
  {
    email: 'ayash@example.com',
    password: 'password123',
    username: 'ayash',
  },
  {
    email: 'bob@example.com',
    password: 'password123',
    username: 'bob_builder',
  },
  {
    email: 'charlie@example.com',
    password: 'password123',
    username: 'charlie_chocolate',
  },
  {
    email: 'admin@chatognito.com',
    password: 'password123',
    username: 'admin',
  },
];

async function seed() {
  console.log(`Starting API-based seeding to ${API_URL}...`);

  for (const user of users) {
    try {
      console.log(`\nProcessing ${user.email}...`);

      // 1. Signup
      const signupRes = await fetch(`${API_URL}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: user.password }),
      });

      if (signupRes.status === 201) {
        console.log(`Signed up successfully.`);
      } else if (signupRes.status === 409) {
        console.log(`User already exists.`);
      } else {
        const err = await signupRes.json();
        console.error(`Signup failed:`, err);
        continue;
      }

      // 2. Login
      const loginRes = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: user.password }),
      });

      if (!loginRes.ok) {
        console.error(`Login failed.`);
        continue;
      }

      const { token, user: currentUser } = await loginRes.json();
      console.log(`Logged in.`);

      // 3. Set Username (only if different)
      if (currentUser.username === user.username) {
        console.log(`Username already set correctly.`);
        continue;
      }

      const usernameRes = await fetch(`${API_URL}/api/v1/users/me/username`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: user.username }),
      });

      if (usernameRes.ok) {
        console.log(`Username set to "${user.username}".`);
      } else {
        const err = await usernameRes.json();
        console.error(`Failed to set username:`, err.error);
      }
    } catch (error) {
      console.error(
        `Error processing ${user.email}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log('\nSeeding process finished.');
}

seed();
