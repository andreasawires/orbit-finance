-- Basic currencies and cost centers for every workspace, including Personal.

INSERT INTO currencies (workspace_id, code, name, symbol)
SELECT w.id, c.code, c.name, c.symbol
FROM workspaces w
CROSS JOIN (VALUES
  ('USD', 'US Dollar', '$'),
  ('EUR', 'Euro', '€'),
  ('JPY', 'Japanese Yen', '¥'),
  ('AED', 'UAE Dirham', 'د.إ')
) AS c(code, name, symbol)
ON CONFLICT (workspace_id, code) DO NOTHING;

INSERT INTO cost_centers (workspace_id, name, color)
SELECT w.id, c.name, c.color
FROM workspaces w
CROSS JOIN (VALUES
  ('Income', '#1f8a4c'),
  ('Housing', '#573cf0'),
  ('Food', '#e07a2f'),
  ('Transport', '#2f6fe0'),
  ('Health', '#d64545'),
  ('Shopping', '#c45ad4'),
  ('Subscriptions', '#0f8f8a'),
  ('Travel', '#d4a017'),
  ('Other', '#6b7280')
) AS c(name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM cost_centers existing
  WHERE existing.workspace_id = w.id
    AND existing.parent_id IS NULL
    AND existing.name = c.name
);

INSERT INTO cost_centers (workspace_id, name, parent_id, color)
SELECT parent.workspace_id, child.name, parent.id, parent.color
FROM cost_centers parent
JOIN (VALUES
  ('Income', 'Salary'),
  ('Housing', 'Rent'),
  ('Food', 'Groceries'),
  ('Food', 'Dining out'),
  ('Transport', 'Transit')
) AS child(parent_name, name) ON child.parent_name = parent.name
WHERE parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM cost_centers existing
    WHERE existing.workspace_id = parent.workspace_id
      AND existing.parent_id = parent.id
      AND existing.name = child.name
  );
