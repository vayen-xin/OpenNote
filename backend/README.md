# OpenNote Backend

Spring Boot 3.3 + Maven + Java 17 backend for OpenNote.

## Environment

- JDK 17
- Maven 3.9+
- MySQL 8.0+

## Run Locally

From the `backend` directory:

```bash
mvn spring-boot:run
```

Default service URL: `http://localhost:8080`

The backend reads database settings from environment variables:

- `MYSQL_URL`
- `MYSQL_USERNAME`
- `MYSQL_PASSWORD`

If no variables are provided, it defaults to:

`jdbc:mysql://127.0.0.1:3306/opennote?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`

## Main API

- `GET /api/banks`
- `GET /api/banks/{bankId}/chapters`
- `GET /api/banks/{bankId}/questions`
- `GET /api/banks/{bankId}/question-index`
- `GET /api/questions/{questionId}`
- `GET /api/questions/{questionId}/detail`
- `POST /api/questions/{questionId}/attempt`
- `GET /api/progress?bankId=`
- `GET /api/doodles/{questionId}?layer=full_canvas`
- `PUT /api/doodles/{questionId}?layer=full_canvas`
- `POST /api/imports/question-bank`
- `GET /api/import-tasks`
- `GET /api/import-tasks/{taskId}`
- `POST /api/import-tasks`

## Notes

- Uses MySQL-backed storage for banks, questions, attempts, and doodles.
- Serves imported media from `/uploads/question-media/**`.
- Supports AI import tasks and direct OpenNote import package ingestion.
- Large banks can load faster through `question-index` plus per-question `detail` requests.
- Base schema and seed data are provided in `sql-init-opennote.sql`.
