# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a LangGraph agent implementation with PostgreSQL memory persistence using Supabase for local development. The agent uses OpenAI's GPT-4o model and includes a search tool for web queries.

## Development Commands

### Running the Agent
- `npm start` - Run the agent once
- `npm run dev` - Run the agent in watch mode for development

### Database Management
- `npm run db:start` - Start Supabase local development stack
- `npm run db:stop` - Stop Supabase containers
- `npm run db:status` - Check Supabase service status and connection details
- `npm run db:studio` - Open Supabase Studio (web interface)
- `npm run db:reset` - Reset the database to initial state

### Initial Setup
- `npm run setup` - Install dependencies and start database

## Architecture

### Core Components

**Agent (`agent.mts`)**
- Single-file LangGraph agent implementation
- Uses StateGraph with conditional routing between agent and tools
- Persistent conversation memory via PostgreSQL checkpointer
- Conversation state maintained through `thread_id` configuration

**Memory Persistence**
- PostgresSaver from `@langchain/langgraph-checkpoint-postgres`
- Connects to local Supabase PostgreSQL instance (port 54322)
- Conversation history persists across agent restarts
- Thread-based conversation tracking (`conversation-num-1` as default)

**Tools System**
- Placeholder search tool for web queries, weather, etc.
- Tools are bound to the OpenAI model via `bindTools()`
- Tool execution handled by ToolNode from LangGraph prebuilt components

### State Management

**GraphState**
- Uses LangGraph Annotation.Root for state definition
- Messages array with concat reducer for conversation history
- State flows: START → agent → (conditional) → tools → agent → END

**Message Flow**
- `routeMessage()` determines if tool calls are needed
- `callModel()` handles OpenAI API interactions
- Streaming output processes and displays responses

## Database Configuration

**Supabase Local Setup**
- PostgreSQL on port 54322
- Supabase Studio on port 54323
- API endpoints on port 54321
- Configuration in `supabase/config.toml`

**Connection Details**
- Database URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Must call `memory.setup()` before using PostgresSaver
- Memory checkpointer automatically creates necessary tables

## Environment Requirements

- Node.js with ES modules support
- Docker for Supabase local development
- OpenAI API key (configured via environment)
- TypeScript execution via tsx

## Key Dependencies

- `@langchain/langgraph` - Core workflow engine
- `@langchain/langgraph-checkpoint-postgres` - PostgreSQL memory persistence
- `@langchain/openai` - OpenAI model integration
- `supabase` - Local database and development tools
- `tsx` - TypeScript execution