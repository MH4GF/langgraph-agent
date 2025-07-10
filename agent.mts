// agent.mts
import "dotenv/config";

import { Annotation } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { END, START, StateGraph } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createClient } from "@supabase/supabase-js";

// PostgreSQL connection string for Supabase local
const memory = PostgresSaver.fromConnString(
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
);

// Setup the PostgreSQL checkpointer
await memory.setup();

// Initialize Supabase client for local development
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Zod schemas for migration operations
const ColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  constraints: z.array(z.string()).optional(),
  default: z.string().optional(),
  nullable: z.boolean().optional(),
});

const BaseOperationSchema = z.object({
  operationType: z.enum(["CREATE_TABLE", "ALTER_TABLE", "CREATE_INDEX", "DROP_INDEX", "ADD_CONSTRAINT", "DROP_CONSTRAINT"]),
  tableName: z.string(),
  requirements: z.string(),
});

const CreateTableSchema = BaseOperationSchema.extend({
  operationType: z.literal("CREATE_TABLE"),
  entityName: z.string().optional(),
  columns: z.array(ColumnSchema).optional(),
});

const AlterTableSchema = BaseOperationSchema.extend({
  operationType: z.literal("ALTER_TABLE"),
  columns: z.array(ColumnSchema).optional(),
});

const CreateIndexSchema = BaseOperationSchema.extend({
  operationType: z.literal("CREATE_INDEX"),
  indexName: z.string(),
  indexColumns: z.array(z.string()),
});

const DropIndexSchema = BaseOperationSchema.extend({
  operationType: z.literal("DROP_INDEX"),
  indexName: z.string(),
});

const AddConstraintSchema = BaseOperationSchema.extend({
  operationType: z.literal("ADD_CONSTRAINT"),
  constraintName: z.string(),
  constraintType: z.enum(["PRIMARY_KEY", "FOREIGN_KEY", "UNIQUE", "CHECK"]),
  constraintDefinition: z.string(),
});

const DropConstraintSchema = BaseOperationSchema.extend({
  operationType: z.literal("DROP_CONSTRAINT"),
  constraintName: z.string(),
});

const MigrationOperationSchema = z.discriminatedUnion("operationType", [
  CreateTableSchema,
  AlterTableSchema,
  CreateIndexSchema,
  DropIndexSchema,
  AddConstraintSchema,
  DropConstraintSchema,
]);

type MigrationOperation = z.infer<typeof MigrationOperationSchema>;

// Create a new design session
const createDesignSession = async () => {
  const { data, error } = await supabase
    .from("design_sessions")
    .insert({})
    .select()
    .single();

  if (error) {
    console.error("Error creating design session:", error);
    throw error;
  }

  return data;
};

// type TimelineItem = {
//   id: string;
//   content: string;
// };

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

const schemaDesignTool = tool(
  async (rawParams: any, config?: RunnableConfig) => {
    try {
      // Validate and parse parameters
      const params = MigrationOperationSchema.parse(rawParams);

      // Get design session ID from config
      const designSessionId = config?.configurable?.thread_id;
      if (!designSessionId) {
        throw new Error("Design session ID not found in config");
      }

      let migrationStructure: any = {
        operationType: params.operationType,
        tableName: params.tableName,
        requirements: params.requirements,
        timestamp: new Date().toISOString()
      };

      let sqlStatements: string[] = [];
      let operationDescription = "";

      switch (params.operationType) {
        case "CREATE_TABLE":
          const defaultColumns = params.columns || [
            { name: "id", type: "UUID", constraints: ["PRIMARY KEY"], default: "gen_random_uuid()" },
            { name: "created_at", type: "TIMESTAMP WITH TIME ZONE", constraints: ["NOT NULL"], default: "now()" },
            { name: "updated_at", type: "TIMESTAMP WITH TIME ZONE", constraints: ["NOT NULL"], default: "now()" }
          ];

          migrationStructure = {
            ...migrationStructure,
            columns: defaultColumns,
            indexes: [
              { name: `idx_${params.tableName}_created_at`, columns: ["created_at"] }
            ],
            triggers: [
              { name: `update_${params.tableName}_updated_at`, event: "BEFORE UPDATE", function: "update_updated_at_column()" }
            ]
          };

          sqlStatements.push(`CREATE TABLE "${params.tableName}" (${defaultColumns.map(col => {
            const constraints = col.constraints ? col.constraints.join(' ') : '';
            const defaultVal = col.default ? `DEFAULT ${col.default}` : '';
            const nullable = col.nullable === false ? 'NOT NULL' : '';
            return `"${col.name}" ${col.type} ${constraints} ${defaultVal} ${nullable}`.trim();
          }).join(', ')});`);

          operationDescription = `Created table "${params.tableName}" with ${defaultColumns.length} columns`;
          break;

        case "ALTER_TABLE":
          if (params.columns) {
            migrationStructure.columns = params.columns;
            params.columns.forEach(col => {
              const constraints = col.constraints ? col.constraints.join(' ') : '';
              const defaultVal = col.default ? `DEFAULT ${col.default}` : '';
              const nullable = col.nullable === false ? 'NOT NULL' : '';
              sqlStatements.push(`ALTER TABLE "${params.tableName}" ADD COLUMN "${col.name}" ${col.type} ${constraints} ${defaultVal} ${nullable};`.trim());
            });
            operationDescription = `Added ${params.columns.length} column(s) to table "${params.tableName}"`;
          }
          break;

        case "CREATE_INDEX":
          if (params.indexName && params.indexColumns) {
            migrationStructure.indexName = params.indexName;
            migrationStructure.indexColumns = params.indexColumns;
            sqlStatements.push(`CREATE INDEX "${params.indexName}" ON "${params.tableName}" (${params.indexColumns.map(col => `"${col}"`).join(', ')});`);
            operationDescription = `Created index "${params.indexName}" on table "${params.tableName}"`;
          }
          break;

        case "DROP_INDEX":
          if (params.indexName) {
            migrationStructure.indexName = params.indexName;
            sqlStatements.push(`DROP INDEX "${params.indexName}";`);
            operationDescription = `Dropped index "${params.indexName}"`;
          }
          break;

        case "ADD_CONSTRAINT":
          if (params.constraintName && params.constraintDefinition) {
            migrationStructure.constraintName = params.constraintName;
            migrationStructure.constraintType = params.constraintType;
            migrationStructure.constraintDefinition = params.constraintDefinition;
            sqlStatements.push(`ALTER TABLE "${params.tableName}" ADD CONSTRAINT "${params.constraintName}" ${params.constraintDefinition};`);
            operationDescription = `Added constraint "${params.constraintName}" to table "${params.tableName}"`;
          }
          break;

        case "DROP_CONSTRAINT":
          if (params.constraintName) {
            migrationStructure.constraintName = params.constraintName;
            sqlStatements.push(`ALTER TABLE "${params.tableName}" DROP CONSTRAINT "${params.constraintName}";`);
            operationDescription = `Dropped constraint "${params.constraintName}" from table "${params.tableName}"`;
          }
          break;
      }

      migrationStructure.sqlStatements = sqlStatements;

      // Get current version number for this design session
      const { data: existingVersions, error: versionError } = await supabase
        .from("schema_versions")
        .select("version")
        .eq("design_session_id", designSessionId)
        .order("version", { ascending: false })
        .limit(1);

      if (versionError) {
        console.error("Error fetching existing versions:", versionError);
        throw versionError;
      }

      const nextVersion = existingVersions.length > 0 ? existingVersions[0].version + 1 : 1;

      // Save schema to database
      const { data: savedSchema, error: saveError } = await supabase
        .from("schema_versions")
        .insert({
          design_session_id: designSessionId,
          version: nextVersion,
          migration: migrationStructure
        })
        .select()
        .single();

      if (saveError) {
        console.error("Error saving schema:", saveError);
        throw saveError;
      }

      // Return formatted response
      return `Migration ${params.operationType} (Version ${nextVersion}):

Operation: ${operationDescription}
Table: ${params.tableName}

SQL Statements:
${sqlStatements.map(sql => `  ${sql}`).join('\n')}

Based on requirements: ${params.requirements}

Migration saved to database with ID: ${savedSchema.id}`;

    } catch (error) {
      console.error("Error in schemaDesignTool:", error);

      // Handle validation errors specifically
      if (error instanceof z.ZodError) {
        return `Schema validation failed:
${error.errors.map(err => `- ${err.path.join('.')}: ${err.message}`).join('\n')}`;
      }

      // Try to get operation info from raw params for error reporting
      const operationType = rawParams?.operationType || 'UNKNOWN';
      const tableName = rawParams?.tableName || 'UNKNOWN';
      const requirements = rawParams?.requirements || 'N/A';

      // Fallback to simple response if database operations fail
      return `Migration ${operationType} for table "${tableName}":

Error: Could not save to database - ${error instanceof Error ? error.message : 'Unknown error'}

Based on requirements: ${requirements}`;
    }
  },
  {
    name: "schema_design",
    description:
      "Use to design database schemas, recommend table structures, and help with database modeling.",
    schema: z.object({
      operationType: z.enum(["CREATE_TABLE", "ALTER_TABLE", "CREATE_INDEX", "DROP_INDEX", "ADD_CONSTRAINT", "DROP_CONSTRAINT"]).describe("The type of database operation to perform."),
      tableName: z.string().describe("The name of the table to operate on."),
      entityName: z.string().optional().describe("The name of the entity (for CREATE_TABLE operations)."),
      requirements: z.string().describe("The requirements and specifications for the operation."),
      columns: z.array(z.object({
        name: z.string(),
        type: z.string(),
        constraints: z.array(z.string()).optional(),
        default: z.string().optional(),
        nullable: z.boolean().optional()
      })).optional().describe("Column definitions for CREATE_TABLE or ALTER_TABLE operations."),
      indexName: z.string().optional().describe("Index name for CREATE_INDEX or DROP_INDEX operations."),
      indexColumns: z.array(z.string()).optional().describe("Columns to include in index."),
      constraintName: z.string().optional().describe("Constraint name for ADD_CONSTRAINT or DROP_CONSTRAINT operations."),
      constraintType: z.enum(["PRIMARY_KEY", "FOREIGN_KEY", "UNIQUE", "CHECK"]).optional().describe("Type of constraint to add."),
      constraintDefinition: z.string().optional().describe("Constraint definition SQL."),
    }),
  }
);

const tools = [schemaDesignTool];

const toolNode = new ToolNode(tools);
const model = new ChatOpenAI({ model: "gpt-4o" });
const boundModel = model.bindTools(tools, { parallel_tool_calls: false });

const routeMessage = (state: typeof GraphState.State) => {
  const { messages: timeline } = state;
  const lastMessage = timeline[timeline.length - 1] as AIMessage;
  // If no tools are called, we can finish (respond to the user)
  if (!lastMessage.tool_calls?.length) {
    return END;
  }
  // Otherwise if there is, we continue and call the tools
  return "tools";
};

const callModel = async (
  state: typeof GraphState.State,
  config?: RunnableConfig
) => {
  const { messages } = state;
  const response = await boundModel.invoke(messages, config);
  return { messages: [response] };
};

const workflow = new StateGraph(GraphState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeMessage)
  .addEdge("tools", "agent");

const graph = workflow.compile({ checkpointer: memory });

// Create a new design session and use its ID as thread_id
const designSession = await createDesignSession();
const config = { configurable: { thread_id: designSession.id } };

console.log(`Created design session: ${designSession.id}`);

// Get command line arguments (skip first 2 which are node and script path)
const args = process.argv.slice(2);
const userMessage = args.length > 0 ? args.join(" ") : "What's my name?";

let inputs = {
  messages: [new HumanMessage(userMessage)],
};
for await (const { messages } of await graph.stream(inputs, {
  ...config,
  streamMode: "values",
})) {
  const msg = messages[messages?.length - 1];
  console.dir(msg, { depth: null });
  console.log("-----\n");
}
