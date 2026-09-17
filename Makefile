install:
	cd server && npm install
	cd ../web && npm install

dev:
	cd server && npm run dev & cd ../web && npm run dev

build:
	cd server && npm run build
	cd ../web && npm run build
