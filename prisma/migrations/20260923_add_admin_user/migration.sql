-- Add admin user
INSERT INTO admin_users (id, email, password_hash, full_name, created_at)
VALUES (
  gen_random_uuid(),
  'admin@juz40-socialcheck.kz',
  '$2a$12$06SQy7ZNbfmWYoPaREKfzuGWfY0ngWpV8.jMKY8LXLT25PBPJ5K7q',
  'Admin',
  now()
)
ON CONFLICT (email) DO NOTHING;

