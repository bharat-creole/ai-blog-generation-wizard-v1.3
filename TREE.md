# Project File Index

This document provides an index of all files and directories in the project, along with a brief description of their purpose and key functionalities.

## Root Level

*   `.gitignore`: Specifies intentionally untracked files that Git should ignore.
*   `AGENT_FLOW_DOCUMENTATION.md`: Documentation detailing the various agent automation flows within the system.
*   `App.tsx`: The main React application component, serving as the root of the frontend UI.
*   `BACKEND_LANGGRAPH_FLOW.md`: Documentation outlining the LangGraph flows implemented in the backend.
*   `deploy.sh`: A shell script used for deploying the application to a server or hosting environment.
*   `DEPLOYMENT.md`: Documentation providing instructions and details about the deployment process.
*   `ecosystem.config.js`: Configuration file for PM2, a process manager for Node.js applications, used for managing application processes in production.
*   `globals.d.ts`: TypeScript declaration file for global types, extending the global scope.
*   `index.css`: Global cascading style sheet (CSS) file, defining base styles for the entire application.
*   `index.html`: The main HTML entry point for the single-page application.
*   `index.tsx`: The entry point for the React application, responsible for rendering the root `App` component into the DOM.
*   `LANGGRAPH_IMPLEMENTATION_GUIDE.md`: A guide detailing how LangGraph is implemented and used within the project.
*   `LANGGRAPH_QUICK_REFERENCE.md`: A quick reference guide for common LangGraph concepts and patterns.
*   `LANGGRAPH_VISUAL_FLOW.md`: Documentation that visually represents the LangGraph flows.
*   `metadata.json`: Contains metadata about the project or application.
*   `package-lock.json`: Records the exact versions of dependencies used in the project, ensuring consistent installations.
*   `package.json`: Defines project metadata and manages dependencies and scripts for the Node.js project.
*   `README.md`: The main README file, providing an overview of the project, setup instructions, and usage details.
*   `SECURITY_AUDIT.md`: Documentation related to security audits performed on the project.
*   `test_streaming.ts`: A TypeScript file containing tests specifically for streaming functionalities.
*   `tsconfig.json`: TypeScript compiler configuration file, defining how TypeScript code is compiled.
*   `types.ts`: Custom TypeScript type definitions used across the project to enhance type safety.
*   `vite.config.ts`: Configuration file for Vite, a fast build tool for modern web projects.

## Editor Configuration

### `.cursor/`
*   `worktrees.json`: Configuration specific to Cursor editor worktrees.

### `.vscode/`
*   `extensions.json`: Recommended VS Code extensions for the project.

## Frontend Components (`components/`)

*   `AgentMode.tsx`: React component for the agent mode interface, enabling AI-driven functionalities.
*   `AppHeader.tsx`: React component for the application's header, typically containing navigation and branding.
*   `config.tsx`: Configuration settings or constants for frontend components.
*   `icons.tsx`: React component or utility file for rendering various SVG icons used in the UI.
*   `PersistenceTest.tsx`: Component for testing data persistence functionality.
*   `StreamingText.tsx`: Component responsible for displaying text content as it streams in, often used for AI responses.

### Agent-Specific Components (`components/agentComponents/`)

*   `AgentModeHeader.tsx`: Header component specifically for the agent mode interface.

#### Chat Components (`components/agentComponents/chat/`)
*   `ChatHeader.tsx`: Header for the chat interface.
*   `ChatInput.tsx`: Component for user input in the chat interface.
*   `ChatInterface.tsx`: The main component that orchestrates the chat UI, combining input, message display, and other chat functionalities.
*   `MessageRenderer.tsx`: Component responsible for rendering individual chat messages, often handling different message types (e.g., text, actions).
*   `PrimaryKeywordSelection.tsx`: Component for selecting primary keywords within the chat context.

#### Content Components (`components/agentComponents/content/`)
*   `BlogContentDisplay.tsx`: Component for displaying the generated or modified blog content.
*   `DraggableOutline.tsx`: Component allowing users to interactively reorder or modify a blog outline via drag-and-drop.

#### Handler Components (`components/agentComponents/handlers/`)
*   `automationFlowHandler.ts`: Handles the logic and state for automation-related agent flows.
*   `blogGenerationFlowHandler.ts`: Manages the flow and state for blog content generation by the agent.
*   `modificationFlowHandler.ts`: Handles agent flows related to modifying existing content.

#### Hooks (`components/agentComponents/hooks/`)
*   `useAgentExecution.ts`: Custom React hook to manage the execution of agent tasks.
*   `useAgentExecutionV2.ts`: Version 2 of the custom React hook for agent execution logic.
*   `useAgentExecutionV3.ts`: Version 3 of the custom React hook for agent execution logic.
*   `useAgentState.ts`: Custom React hook for managing and accessing the state of the agent.
*   `useIntentAnalysis.ts`: Custom React hook to perform and manage user intent analysis.

#### Panels (`components/agentComponents/panels/`)
*   `BlogInfoPanel.tsx`: Displays detailed information about a blog post.
*   `SettingsPanel.tsx`: Provides an interface for configuring agent or application settings.
*   `TracePanel.tsx`: Displays a trace or log of agent's operations, useful for debugging and understanding agent behavior.

#### Selections (`components/agentComponents/selections/`)
*   `InterlinkingForm.tsx`: Form component for managing interlinking within blog content.
*   `OutlineApproval.tsx`: Component where users can review and approve a generated blog outline.
*   `PrimaryKeywordSelection.tsx`: Component for selecting primary keywords, potentially distinct from the chat version.
*   `ReferencesForm.tsx`: Form for adding and managing references for blog content.
*   `SecondaryKeywordSelection.tsx`: Component for selecting secondary keywords.
*   `TitleSelection.tsx`: Component for selecting or suggesting blog titles.

#### Styles (`components/agentComponents/styles/`)
*   `agentModeStyles.ts`: TypeScript file defining styles for the agent mode interface, often using CSS-in-JS or similar.
*   `form-elements.css`: Specific CSS styles for form elements within agent components.

#### Types (`components/agentComponents/types/`)
*   `agentTypes.ts`: TypeScript type definitions specific to agent components and their data structures.
*   `chatTypes.ts`: TypeScript type definitions for chat-related data structures.

#### Utilities (`components/agentComponents/utils/`)
*   `agentHelpers.ts`: Helper functions for agent-related tasks.
*   `agentStateUtils.ts`: Utility functions for manipulating and managing agent state.
*   `messageUtils.ts`: Utility functions for processing and formatting messages.
*   `topicExtraction.ts`: Utility for extracting topics from text.

### Assets (`components/assets/`)
*   `blogcount.svg`: SVG icon related to blog count.
*   `Bloggr-Logo.png`: PNG image file for the Bloggr logo.
*   `Bloggr.ai.svg`: SVG image file for the Bloggr.ai logo.
*   `iconamoon_edit-fill.svg`: SVG icon for an edit action.
*   `plagiarism.svg`: SVG icon related to plagiarism.
*   `regenerate.svg`: SVG icon for a regenerate action.

### Common Components (`components/common/`)
*   `SidebarHistory.tsx`: Generic sidebar component displaying history.
*   `Spinner.tsx`: A reusable loading spinner component.

### History Components (`components/history/`)
*   `AgentHistoryList.tsx`: Displays a list of past agent interactions or tasks.
*   `HistoryMessage.tsx`: Renders an individual message within the history viewer.
*   `HistoryThreadViewer.tsx`: Component for viewing a complete thread of historical agent interactions.

## Polyfills (`polyfills/`)
*   `async_hooks.ts`: Polyfill or shim for Node.js `async_hooks` module, enabling functionality in environments where it might not be natively available.

## Database (`prisma/`)

*   `dev.db`: The development SQLite database file.
*   `dev.db-journal`: Journal file for the SQLite database, used for transaction management.
*   `schema.prisma`: The Prisma schema definition file, defining the application's data model and database connections.

### Migrations (`prisma/migrations/`)
*   `migration_lock.toml`: A lock file used by Prisma Migrate to ensure consistency during database migrations.
*   `20251129083506_init_postgres/`: Directory for the initial PostgreSQL migration.
    *   `migration.sql`: SQL script for the initial database schema creation.
*   `20251201_add_agent_history/`: Directory for the migration to add agent history functionality.
    *   `migration.sql`: SQL script for adding agent history tables and columns.

## Backend Server (`server/`)

*   `index.ts`: The main entry point for the backend server, typically setting up the Express app, routes, and middleware.
*   `testGoogleAdsAPI.ts`: A script or module for testing integration with the Google Ads API.
*   `tokenManager.ts`: Manages authentication tokens, including generation, validation, and refresh.

### Agent Backend Logic (`server/agent/`)

*   `AGENT_ARCHITECTURE.md`: Documentation detailing the architecture of the backend agent system.
*   `checkpointer.ts`: Handles the saving and restoring of agent state (checkpointing), crucial for long-running or resumable agent tasks.
*   `contextManagerAgent.ts`: Manages the conversational context for the agent, ensuring relevant information is available across turns.
*   `conversationHandler.ts`: Processes and responds to conversational input, routing to appropriate agent functionalities.
*   `graph.ts`: Defines the state graph for the agent using LangGraph, orchestrating complex multi-step AI tasks.
*   `intentClassifier.ts`: Identifies the user's intent from their input, directing the agent's subsequent actions.
*   `messageReframer.ts`: Reframes or rephrases messages to improve clarity or align with agent's processing needs.
*   `PRIMARY_AGENT_USAGE.md`: Documentation on how to use and interact with the primary agent.
*   `primaryAgent.ts`: Implementation of the primary AI agent, handling core functionalities.
*   `secondaryAgent.ts`: Implementation of a secondary or specialized AI agent, supporting the primary agent.
*   `state.ts`: Defines the structure and types for the agent's internal state.
*   `nodes/`: Directory containing individual nodes or steps within the agent's LangGraph.
    *   `generation.ts`: LangGraph node responsible for generating content (e.g., blog posts, outlines).
    *   `planning.ts`: LangGraph node focused on planning the agent's actions or content structure.
    *   `research.ts`: LangGraph node for performing research, typically involving external tools like search engines.

### Database Services (`server/db/`)

*   `agentHistoryService.ts`: Service layer for interacting with the database to store and retrieve agent interaction history.
*   `blogService.ts`: Service layer for managing blog-related data in the database (e.g., creating, reading, updating blog posts).
*   `userService.ts`: Service layer for handling user-related data and authentication with the database.

### Hooks (`server/hooks/`)

*   `blogCompletionHook.ts`: Server-side hook that triggers actions upon the completion of a blog generation process.

### Middleware (`server/middleware/`)

*   `auth.ts`: Express middleware for handling user authentication and authorization.

## Shared Services (`services/`)

*   `agentApiClient.ts`: Client-side module for making API requests to the backend agent services.
*   `agentIntentClassifier.ts`: Service for classifying user intent, potentially shared between frontend and backend or used for specific client-side logic.
*   `agentService.ts`: A high-level service that encapsulates interactions with various agent functionalities.
*   `authUtils.ts`: Utility functions related to authentication, often including token handling or session management.
*   `automationEngine.ts`: The core engine responsible for executing automated workflows and tasks.
*   `conversationHandler.ts`: Manages conversational logic, processing user input and generating agent responses.
*   `dataExtractor.ts`: Service for extracting specific data points from unstructured or semi-structured text.
*   `geminiService.ts`: Service for interacting with the Google Gemini API, used for AI model invocations.
*   `googleSearchService.ts`: Service for performing searches using the Google Search API.
*   `headingExtraction.ts`: Service for extracting headings and subheadings from content.
*   `keywordService.ts`: Service for managing keywords, including generation, analysis, and selection.
*   `queryHandler.ts`: Handles and processes various types of queries from different parts of the application.
*   `retrieval.ts`: Service for retrieving information or content from various sources.

### LangGraph Services (`services/langgraph/`)

*   `agentGraph.ts`: Defines the LangGraph structure specifically for the agent's operations.
*   `blogGraph.ts`: Defines the LangGraph structure for blog generation workflows.

### Version 2 Services (`services/v2/`)

*   `graph.ts`: Defines the LangGraph structure for version 2 of certain services.
*   `state.ts`: Defines the state structure for version 2 services.
*   `nodes/`: Contains individual nodes for version 2 LangGraph.
    *   `generation.ts`: LangGraph node for content generation in v2.
    *   `planning.ts`: LangGraph node for planning in v2.
    *   `research.ts`: LangGraph node for research in v2.
*   `persistence/`: Persistence mechanisms for version 2 services.
    *   `BrowserCheckpointer.ts`: A checkpointer implementation designed to store state in the browser's local storage or similar.
    *   `db.ts`: Database utility functions specific to v2 persistence.

## Utilities (`utils/`)

*   `retryWithBackoff.ts`: A utility function that implements a retry mechanism with exponential backoff for robust error handling in API calls or other operations.
