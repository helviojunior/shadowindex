# SQL

[🏠 Home](Home) · [🇧🇷 Português](SQL-PT)

Connect to discovered databases and run **enumeration** and data-collection
queries.

![SQL](images/sql.png)

## What it shows

- Registered **connections**, each with a database **type** (MS-SQL, MySQL,
  PostgreSQL, Oracle, MariaDB, MongoDB, SQLite) and verification status.
- SQL command **presets** per database type (ready-made queries).
- **History** of executed queries, with result, execution time and status.

## Connection wizard

When adding a connection, use the **Wizard** mode to fill structured fields
(host, port, database, username, password and extras) — the *connection string*
is **assembled automatically on the backend**, in the correct format for the
chosen database type. A **Manual** mode is also available to paste a ready-made
string.

![SQL connection wizard](images/sql-wizard.png)

## How to use

1. Create a **connection**: pick the **database type** and fill the **Wizard**
   fields (or paste the string in **Manual** mode). Optionally attach a
   [credential](Credentials-EN) and a [proxy](Proxy-Servers-EN).
2. Verify the connection.
3. Run a query — manually or from a **preset** (e.g. list databases, logins,
   tables).
4. Check the **history** to review previous enumerations and their results.

### Enumeration examples

```sql
SELECT name FROM sys.databases ORDER BY name;                  -- databases (MS-SQL)
SELECT name FROM sys.server_principals WHERE type IN ('S','U'); -- logins
SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES; -- tables
```
