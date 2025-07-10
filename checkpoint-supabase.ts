import {
  BaseCheckpointSaver,
  type CheckpointTuple,
  type SerializerProtocol,
  type Checkpoint,
  type CheckpointMetadata,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { type RunnableConfig } from "@langchain/core/runnables";
import { type SupabaseClient } from "@supabase/supabase-js";

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: any;
  metadata: any;
}

interface CheckpointBlobRow {
  thread_id: string;
  checkpoint_ns: string;
  channel: string;
  version: string;
  type: string;
  blob: Uint8Array | null;
}

interface CheckpointWriteRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  task_id: string;
  idx: number;
  channel: string;
  type: string | null;
  blob: Uint8Array;
}

export interface SupabaseSaverConfig {
  schema?: string;
}

export class SupabaseSaver extends BaseCheckpointSaver {
  private client: SupabaseClient;
  private schema: string;

  constructor(
    client: SupabaseClient,
    serde?: SerializerProtocol,
    config?: SupabaseSaverConfig
  ) {
    super(serde);
    this.client = client;
    this.schema = config?.schema ?? "public";
  }

  static fromClient(
    client: SupabaseClient,
    serde?: SerializerProtocol,
    config?: SupabaseSaverConfig
  ): SupabaseSaver {
    return new SupabaseSaver(client, serde, config);
  }

  private getTableName(table: string): string {
    return this.schema === "public" ? table : `${this.schema}.${table}`;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId) {
      throw new Error("Missing thread_id in config");
    }

    // Build query for latest checkpoint if no specific checkpoint_id
    let query = this.client
      .from(this.getTableName("checkpoints"))
      .select("*")
      .eq("thread_id", threadId)
      .eq("checkpoint_ns", checkpointNs);

    if (checkpointId) {
      query = query.eq("checkpoint_id", checkpointId);
    } else {
      query = query.order("checkpoint_id", { ascending: false }).limit(1);
    }

    const { data: checkpointData, error: checkpointError } = await query.single();

    if (checkpointError || !checkpointData) {
      return undefined;
    }

    // Get channel values from checkpoint_blobs
    const { data: blobData, error: blobError } = await this.client
      .from(this.getTableName("checkpoint_blobs"))
      .select("*")
      .eq("thread_id", threadId)
      .eq("checkpoint_ns", checkpointNs);

    if (blobError) {
      throw new Error(`Failed to fetch checkpoint blobs: ${blobError.message}`);
    }

    // Get pending writes
    const { data: writesData, error: writesError } = await this.client
      .from(this.getTableName("checkpoint_writes"))
      .select("*")
      .eq("thread_id", threadId)
      .eq("checkpoint_ns", checkpointNs)
      .eq("checkpoint_id", checkpointData.checkpoint_id)
      .order("idx", { ascending: true });

    if (writesError) {
      throw new Error(`Failed to fetch checkpoint writes: ${writesError.message}`);
    }

    // Deserialize checkpoint
    const checkpoint = this.serde.loadsTyped("json", checkpointData.checkpoint);
    const metadata = this.serde.loadsTyped("json", checkpointData.metadata);

    // Build channel values
    const channelValues: Record<string, any> = {};
    for (const blob of blobData || []) {
      if (blob.blob) {
        channelValues[blob.channel] = this.serde.loadsTyped(blob.type, blob.blob);
      }
    }

    // Build pending writes
    const pendingWrites: [string, string, any][] = [];
    for (const write of writesData || []) {
      pendingWrites.push([
        write.task_id,
        write.channel,
        this.serde.loadsTyped(write.type || "", write.blob),
      ]);
    }

    const checkpointTuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointData.checkpoint_id,
        },
      },
      checkpoint: {
        ...checkpoint,
        channel_values: channelValues,
      },
      metadata,
      parentConfig: checkpointData.parent_checkpoint_id ? {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointData.parent_checkpoint_id,
        },
      } : undefined,
      pendingWrites,
    };

    return checkpointTuple;
  }

  async *list(
    config: RunnableConfig,
    options?: {
      filter?: Record<string, any>;
      before?: RunnableConfig;
      limit?: number;
    }
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";

    if (!threadId) {
      throw new Error("Missing thread_id in config");
    }

    let query = this.client
      .from(this.getTableName("checkpoints"))
      .select("*")
      .eq("thread_id", threadId)
      .eq("checkpoint_ns", checkpointNs)
      .order("checkpoint_id", { ascending: false });

    if (options?.before?.configurable?.checkpoint_id) {
      query = query.lt("checkpoint_id", options.before.configurable.checkpoint_id);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data: checkpoints, error } = await query;

    if (error) {
      throw new Error(`Failed to list checkpoints: ${error.message}`);
    }

    for (const checkpoint of checkpoints || []) {
      const checkpointConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpoint.checkpoint_id,
        },
      };

      const tuple = await this.getTuple(checkpointConfig);
      if (tuple) {
        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Record<string, string | number>
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = checkpoint.id;

    if (!threadId) {
      throw new Error("Missing thread_id in config");
    }

    // Serialize checkpoint and metadata
    const [, serializedCheckpoint] = this.serde.dumpsTyped(checkpoint);
    const [, serializedMetadata] = this.serde.dumpsTyped(metadata);

    // Upsert checkpoint
    const { error: checkpointError } = await this.client
      .from(this.getTableName("checkpoints"))
      .upsert({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        parent_checkpoint_id: config.configurable?.checkpoint_id || null,
        type: checkpoint.channel_versions ? "standard" : null,
        checkpoint: serializedCheckpoint,
        metadata: serializedMetadata,
      }, {
        onConflict: "thread_id,checkpoint_ns,checkpoint_id"
      });

    if (checkpointError) {
      throw new Error(`Failed to save checkpoint: ${checkpointError.message}`);
    }

    // Save channel values to blobs
    for (const [channel, value] of Object.entries(newVersions)) {
      const [type, serializedValue] = this.serde.dumpsTyped(value);
      
      const { error: blobError } = await this.client
        .from(this.getTableName("checkpoint_blobs"))
        .upsert({
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          channel,
          version: String(value),
          type,
          blob: serializedValue,
        }, {
          onConflict: "thread_id,checkpoint_ns,channel,version"
        });

      if (blobError) {
        throw new Error(`Failed to save checkpoint blob: ${blobError.message}`);
      }
    }

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId || !checkpointId) {
      throw new Error("Missing thread_id or checkpoint_id in config");
    }

    const writeRows = writes.map(([channel, value], idx) => {
      const [type, serializedValue] = this.serde.dumpsTyped(value);
      return {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        task_id: taskId,
        idx,
        channel,
        type,
        blob: serializedValue,
      };
    });

    const { error } = await this.client
      .from(this.getTableName("checkpoint_writes"))
      .upsert(writeRows, {
        onConflict: "thread_id,checkpoint_ns,checkpoint_id,task_id,idx"
      });

    if (error) {
      throw new Error(`Failed to save checkpoint writes: ${error.message}`);
    }
  }

  // Simplified setup method that doesn't create tables
  async setup(): Promise<void> {
    // In this implementation, we assume tables are already created via Supabase migrations
    // This method is kept for compatibility but doesn't perform any operations
    return Promise.resolve();
  }
}