# Node.js 26.8.2 compatibility patch

This patch updates Trust Dependency Mapper v2 to target Node.js 26.8.2.

## Changed
- Removed `better-sqlite3` and its native TypeScript types.
- Switched persistence to Node.js built-in `node:sqlite` (`DatabaseSync`).
- Added Node/npm engine constraints: Node `>=26.8.2 <27`, npm `>=11.19.1 <12`.
- Updated Node typings to `@types/node` 26.x.
- Updated multer to 2.x and its type package.
- Updated TypeScript to 5.9.x and compiler target to ES2024.
- Added `.nvmrc` and `.node-version` with `26.8.2`.
- Removed the unused legacy `ADMIN_TOKEN` config.
- Replaced the dynamic database `require()` in the admin audit route with a typed import.

## Why
Node.js 26.8.2 is the current Node release and ships the built-in SQLite module, so the project no longer needs the native `better-sqlite3` build that previously failed under newer Node runtimes. Node 26.8.2 also ships npm 11.19.1.

## Install
```powershell
cd server
npm install
npm run build
npm test
```

No Visual Studio C++ build tools are required for the database layer.
