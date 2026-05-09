package com.opennote.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class AiImportTaskService {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ObjectMapper objectMapper;
    private final QuestionImportService importService;
    private final Path taskRoot;
    private final Path agentScript;
    private final String pythonCommand;
    private final String defaultModel;
    private final String defaultApiUrl;
    private final String defaultApiKey;
    private final int defaultWorkers;
    private final int defaultSkipFirst;
    private final ExecutorService executor = Executors.newFixedThreadPool(2);

    public AiImportTaskService(
            ObjectMapper objectMapper,
            QuestionImportService importService,
            @Value("${opennote.ai-import.task-root:./storage/import-tasks}") String taskRoot,
            @Value("${opennote.ai-import.agent-script:../agent/run.py}") String agentScript,
            @Value("${opennote.ai-import.python-command:python}") String pythonCommand,
            @Value("${opennote.ai-import.default-model:qwen-vl-max}") String defaultModel,
            @Value("${opennote.ai-import.default-api-url:https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions}") String defaultApiUrl,
            @Value("${opennote.ai-import.default-api-key:}") String defaultApiKey,
            @Value("${opennote.ai-import.default-workers:4}") int defaultWorkers,
            @Value("${opennote.ai-import.default-skip-first:10}") int defaultSkipFirst
    ) {
        this.objectMapper = objectMapper;
        this.importService = importService;
        this.taskRoot = Path.of(taskRoot).toAbsolutePath().normalize();
        this.agentScript = resolvePath(agentScript);
        this.pythonCommand = pythonCommand;
        this.defaultModel = defaultModel;
        this.defaultApiUrl = defaultApiUrl;
        this.defaultApiKey = defaultApiKey;
        this.defaultWorkers = defaultWorkers;
        this.defaultSkipFirst = defaultSkipFirst;
        try {
            Files.createDirectories(this.taskRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to create ai import task root", e);
        }
    }

    public TaskSummary createTask(
            String mode,
            String materialName,
            Integer splitPage,
            MultipartFile questionFile,
            MultipartFile answerFile,
            String providerModelName,
            String providerBaseUrl,
            String providerApiKey
    ) {
        String normalizedMode = normalizeMode(mode);
        if (materialName == null || materialName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Material name is required");
        }
        if (questionFile == null || questionFile.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Question file is required");
        }
        if ("double".equals(normalizedMode) && (answerFile == null || answerFile.isEmpty())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Answer file is required");
        }
        if ("single".equals(normalizedMode) && (splitPage == null || splitPage <= 1)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Split page must be greater than 1");
        }

        String taskId = "task-" + Instant.now().toEpochMilli() + "-" + UUID.randomUUID().toString().substring(0, 8);
        Path taskDir = taskRoot.resolve(taskId);
        Path inputDir = taskDir.resolve("input");
        Path outputRoot = taskDir.resolve("output");
        Path logsDir = taskDir.resolve("logs");
        try {
            Files.createDirectories(inputDir);
            Files.createDirectories(outputRoot);
            Files.createDirectories(logsDir);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to create task directory", e);
        }

        String questionStoredName = "question" + extensionOf(questionFile.getOriginalFilename());
        Path questionPath = inputDir.resolve(questionStoredName);
        copyFile(questionFile, questionPath);

        String answerStoredName = null;
        Path answerPath = null;
        if ("double".equals(normalizedMode)) {
            answerStoredName = "answer" + extensionOf(answerFile.getOriginalFilename());
            answerPath = inputDir.resolve(answerStoredName);
            copyFile(answerFile, answerPath);
        }

        ProviderConfig provider = new ProviderConfig(
                blankToNull(providerModelName),
                blankToNull(providerBaseUrl),
                blankToNull(providerApiKey)
        );

        TaskState task = new TaskState();
        task.id = taskId;
        task.mode = normalizedMode;
        task.materialName = materialName.trim();
        task.status = "queued";
        task.createdAt = Instant.now().toString();
        task.updatedAt = task.createdAt;
        task.questionFileName = Objects.requireNonNullElse(questionFile.getOriginalFilename(), questionStoredName);
        task.answerFileName = answerFile == null ? null : Objects.requireNonNullElse(answerFile.getOriginalFilename(), answerStoredName);
        task.splitPage = splitPage;
        task.taskDir = taskDir.toString();
        task.outputRunDir = outputRoot.resolve("run").toString();
        task.providerModelName = provider.modelName;
        task.providerBaseUrl = provider.baseUrl;
        task.usesCustomProvider = provider.isCustom();
        saveTask(taskDir, task);
        saveProvider(taskDir, provider);

        Path finalAnswerPath = answerPath;
        executor.submit(() -> runTask(taskId, questionPath, finalAnswerPath));
        return toSummary(task);
    }

    public List<TaskSummary> listTasks() {
        try {
            if (!Files.exists(taskRoot)) {
                return List.of();
            }
            List<TaskSummary> tasks = new ArrayList<>();
            try (var stream = Files.list(taskRoot)) {
                stream.filter(Files::isDirectory)
                        .sorted(Comparator.reverseOrder())
                        .forEach(path -> {
                            TaskState task = readTask(path);
                            if (task != null) {
                                tasks.add(toSummary(task));
                            }
                        });
            }
            tasks.sort(Comparator.comparing(TaskSummary::createdAt).reversed());
            return tasks;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read import tasks", e);
        }
    }

    public TaskSummary getTask(String taskId) {
        TaskState task = readTask(taskRoot.resolve(taskId));
        if (task == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Import task not found");
        }
        return toSummary(task);
    }

    private void runTask(String taskId, Path questionPath, Path answerPath) {
        Path taskDir = taskRoot.resolve(taskId);
        TaskState task = requireTask(taskDir);
        ProviderConfig provider = readProvider(taskDir);
        task.status = "running";
        task.startedAt = Instant.now().toString();
        task.updatedAt = task.startedAt;
        saveTask(taskDir, task);

        Path outputRoot = taskDir.resolve("output");
        Path runDir = outputRoot.resolve("run");
        Path stdout = taskDir.resolve("logs").resolve("agent.stdout.log");
        Path stderr = taskDir.resolve("logs").resolve("agent.stderr.log");

        List<String> command = new ArrayList<>();
        command.add(pythonCommand);
        command.add(agentScript.toString());
        command.add("--run-id");
        command.add("run");
        command.add("--output-root");
        command.add(outputRoot.toString());
        command.add("--bank-name");
        command.add(task.materialName);
        command.add("--workers");
        command.add(String.valueOf(defaultWorkers));
        command.add("--skip-first");
        command.add(String.valueOf(defaultSkipFirst));
        command.add("--no-package-zip");
        command.add("--question-pdf");
        command.add(questionPath.toString());

        if ("double".equals(task.mode)) {
            command.add("--answer-pdf");
            command.add(answerPath.toString());
        } else {
            command.add("--answer-pdf");
            command.add(questionPath.toString());
            command.add("--question-end-page");
            command.add(String.valueOf(task.splitPage - 1));
            command.add("--answer-start-page");
            command.add(String.valueOf(task.splitPage));
        }

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectOutput(stdout.toFile());
        builder.redirectError(stderr.toFile());
        Map<String, String> env = builder.environment();
        env.put("OPENNOTE_AGENT_VISION_MODEL", choose(provider.modelName, defaultModel));
        env.put("OPENNOTE_AGENT_API_URL", choose(provider.baseUrl, defaultApiUrl));
        if (provider.apiKey != null && !provider.apiKey.isBlank()) {
            env.put("OPENNOTE_AGENT_API_KEY", provider.apiKey);
        } else if (defaultApiKey != null && !defaultApiKey.isBlank()) {
            env.put("OPENNOTE_AGENT_API_KEY", defaultApiKey);
        }

        try {
            Process process = builder.start();
            int exit = process.waitFor();
            if (exit != 0) {
                task.status = "failed";
                task.updatedAt = Instant.now().toString();
                task.lastError = "AI import worker exited with code " + exit;
                saveTask(taskDir, task);
                return;
            }

            QuestionImportService.ImportResult importResult = importService.importRunDirectory(runDir);
            task.status = "done";
            task.updatedAt = Instant.now().toString();
            task.finishedAt = task.updatedAt;
            task.importedBankId = importResult.bankId();
            task.importedQuestionCount = importResult.questionCount();
            task.importedChapterCount = importResult.chapterCount();
            task.mediaBaseUrl = importResult.mediaBaseUrl();
            task.warnings = importResult.warnings();
            Path reportPath = runDir.resolve("reports").resolve("match_report.json");
            if (Files.exists(reportPath)) {
                task.matchReport = objectMapper.readValue(reportPath.toFile(), MAP_TYPE);
            }
            saveTask(taskDir, task);
        } catch (Exception e) {
            task.status = "failed";
            task.updatedAt = Instant.now().toString();
            task.finishedAt = task.updatedAt;
            task.lastError = e.getMessage();
            saveTask(taskDir, task);
        }
    }

    private void copyFile(MultipartFile file, Path target) {
        try {
            Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to save uploaded file", e);
        }
    }

    private void saveProvider(Path taskDir, ProviderConfig provider) {
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(taskDir.resolve("provider.json").toFile(), provider);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to persist provider config", e);
        }
    }

    private ProviderConfig readProvider(Path taskDir) {
        Path file = taskDir.resolve("provider.json");
        try {
            if (!Files.exists(file)) {
                return new ProviderConfig(null, null, null);
            }
            return objectMapper.readValue(file.toFile(), ProviderConfig.class);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read provider config", e);
        }
    }

    private void saveTask(Path taskDir, TaskState task) {
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(taskDir.resolve("task.json").toFile(), task);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to persist import task", e);
        }
    }

    private TaskState readTask(Path taskDir) {
        Path file = taskDir.resolve("task.json");
        if (!Files.exists(file)) {
            return null;
        }
        try {
            return objectMapper.readValue(file.toFile(), TaskState.class);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read import task", e);
        }
    }

    private TaskState requireTask(Path taskDir) {
        TaskState task = readTask(taskDir);
        if (task == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Import task not found");
        }
        return task;
    }

    private TaskSummary toSummary(TaskState task) {
        String providerLabel = task.usesCustomProvider
                ? choose(task.providerBaseUrl, "自定义地址")
                : "系统默认";
        return new TaskSummary(
                task.id,
                task.mode,
                task.materialName,
                task.status,
                task.createdAt,
                task.updatedAt,
                task.questionFileName,
                task.answerFileName,
                task.splitPage,
                providerLabel,
                task.importedBankId,
                task.importedQuestionCount,
                task.importedChapterCount,
                task.mediaBaseUrl,
                task.warnings == null ? List.of() : task.warnings,
                task.lastError,
                task.matchReport
        );
    }

    private String normalizeMode(String mode) {
        if ("single".equalsIgnoreCase(mode)) {
            return "single";
        }
        if ("double".equalsIgnoreCase(mode)) {
            return "double";
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported import mode");
    }

    private String extensionOf(String filename) {
        if (filename == null) {
            return ".pdf";
        }
        int index = filename.lastIndexOf('.');
        return index >= 0 ? filename.substring(index) : ".pdf";
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String choose(String custom, String fallback) {
        return custom == null || custom.isBlank() ? fallback : custom;
    }

    private Path resolvePath(String rawPath) {
        Path path = Path.of(rawPath);
        if (path.isAbsolute()) {
            return path.normalize();
        }
        Path base = Path.of("").toAbsolutePath();
        Path direct = base.resolve(path).normalize();
        if (Files.exists(direct)) {
            return direct;
        }
        Path parent = base.getParent();
        if (parent != null) {
            Path sibling = parent.resolve(path).normalize();
            if (Files.exists(sibling)) {
                return sibling;
            }
        }
        return direct;
    }

    @PreDestroy
    public void shutdown() {
        executor.shutdownNow();
    }

    private static class TaskState {
        public String id;
        public String mode;
        public String materialName;
        public String status;
        public String createdAt;
        public String updatedAt;
        public String startedAt;
        public String finishedAt;
        public String questionFileName;
        public String answerFileName;
        public Integer splitPage;
        public String taskDir;
        public String outputRunDir;
        public String providerModelName;
        public String providerBaseUrl;
        public boolean usesCustomProvider;
        public Long importedBankId;
        public Integer importedQuestionCount;
        public Integer importedChapterCount;
        public String mediaBaseUrl;
        public List<String> warnings;
        public String lastError;
        public Map<String, Object> matchReport;
    }

    private record ProviderConfig(String modelName, String baseUrl, String apiKey) {
        boolean isCustom() {
            return modelName != null || baseUrl != null || apiKey != null;
        }
    }

    public record TaskSummary(
            String id,
            String mode,
            String materialName,
            String status,
            String createdAt,
            String updatedAt,
            String questionFileName,
            String answerFileName,
            Integer splitPage,
            String providerLabel,
            Long importedBankId,
            Integer importedQuestionCount,
            Integer importedChapterCount,
            String mediaBaseUrl,
            List<String> warnings,
            String lastError,
            Map<String, Object> matchReport
    ) {
    }
}
