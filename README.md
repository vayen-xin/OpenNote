# OpenNote

OpenNote is a browser-based study notebook and question bank system designed for tablet handwriting, answer review, and AI-assisted question import.

## What OpenNote Does

- Three-column brushing interface: chapter list, question workspace, right-side tools
- Handwritten doodle and note layers for each question
- Answer show/hide and manual correctness marking workflow
- MySQL-backed question banks, progress, and doodle storage
- AI import workflow for converting external materials into OpenNote question banks
- Image-aware question rendering for imported banks
- Lazy-loaded question detail pages for large banks

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Spring Boot 3.3 + Java 17 + Maven
- Database: MySQL
- AI import pipeline: Python
- Deployment: Docker + Nginx

## Repository Structure

- `front/`: browser client
- `backend/`: Spring Boot API and import endpoints
- `agent/`: AI extraction, matching, and import-package generation tools
- `deploy/`: deployment assets used for server releases

## Current Highlights

- Supports local development with `/api` and `/uploads` proxying
- Supports imported Markdown image blocks inside question stems and explanations
- Supports large-bank lazy loading through question index plus question detail APIs
- Supports asynchronous AI import tasks with isolated task folders
- Includes deployment configuration used for the current OpenNote server runtime

## Getting Started

### Frontend

From `front/`:

```bash
npm install
npm run dev
```

### Backend

From `backend/`:

```bash
mvn spring-boot:run
```

Default backend URL:

`http://localhost:8080`

### Database

The backend reads database settings from environment variables:

- `MYSQL_URL`
- `MYSQL_USERNAME`
- `MYSQL_PASSWORD`

If they are not provided, it defaults to local MySQL:

`jdbc:mysql://127.0.0.1:3306/opennote?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`

## Related Readmes

- `front/README.md`
- `backend/README.md`

## Status

The repository currently contains the running OpenNote codebase, including the integrated AI import workflow and the lazy-loaded question experience used to improve large-bank performance.
