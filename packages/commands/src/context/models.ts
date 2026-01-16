import type { int } from "@tsonic/core/types.js";

export class ContextSSHConfig {
  user: string | undefined;
  port: int | undefined;
  key: string | undefined;
  bastion: string | undefined;
  connectTimeoutSeconds: int | undefined;

  constructor() {
    this.user = undefined;
    this.port = undefined;
    this.key = undefined;
    this.bastion = undefined;
    this.connectTimeoutSeconds = undefined;
  }
}

export class ContextHostLabel {
  key: string;
  value: string;

  constructor(key: string, value: string) {
    this.key = key;
    this.value = value;
  }
}

export class ContextHost {
  name: string;
  addr: string;
  meshIP: string | undefined;
  labels: ContextHostLabel[];

  constructor(name: string, addr: string) {
    this.name = name;
    this.addr = addr;
    this.meshIP = undefined;
    const labels: ContextHostLabel[] = [];
    this.labels = labels;
  }
}

export class ContextDefaults {
  composeFiles: string[];
  envFile: string | undefined;
  projectName: string | undefined;

  constructor() {
    const composeFiles: string[] = [];
    this.composeFiles = composeFiles;
    this.envFile = undefined;
    this.projectName = undefined;
  }
}

export class ContextProxy {
  driver: string | undefined;
  domains: string[];

  constructor() {
    this.driver = undefined;
    const domains: string[] = [];
    this.domains = domains;
  }
}

export class ContextArtifacts {
  mode: string | undefined;
  remoteCacheDir: string | undefined;
  concurrency: int | undefined;
  retainReleases: int | undefined;

  constructor() {
    this.mode = undefined;
    this.remoteCacheDir = undefined;
    this.concurrency = undefined;
    this.retainReleases = undefined;
  }
}

export class ContextSafetyConfirm {
  requiredFor: string[];
  token: string | undefined;

  constructor() {
    const requiredFor: string[] = [];
    this.requiredFor = requiredFor;
    this.token = undefined;
  }
}

export class ContextSafety {
  level: string;
  allowFrom: string[];
  confirm: ContextSafetyConfirm;

  constructor() {
    this.level = "safe";
    this.allowFrom = ["local", "ci"];
    this.confirm = new ContextSafetyConfirm();
  }
}

export class ContextConfig {
  name: string;
  provider: string | undefined;
  ssh: ContextSSHConfig;
  hosts: ContextHost[];
  defaults: ContextDefaults;
  proxy: ContextProxy;
  artifacts: ContextArtifacts;
  safety: ContextSafety;

  constructor(name: string) {
    this.name = name;
    this.provider = undefined;
    this.ssh = new ContextSSHConfig();
    const hosts: ContextHost[] = [];
    this.hosts = hosts;
    this.defaults = new ContextDefaults();
    this.proxy = new ContextProxy();
    this.artifacts = new ContextArtifacts();
    this.safety = new ContextSafety();
  }
}

export class ContextLoadResult {
  readonly success: boolean;
  readonly context: ContextConfig | undefined;
  readonly error: string | undefined;

  constructor(success: boolean, context: ContextConfig | undefined, error: string | undefined) {
    this.success = success;
    this.context = context;
    this.error = error;
  }

  static ok(context: ContextConfig): ContextLoadResult {
    return new ContextLoadResult(true, context, undefined);
  }

  static fail(message: string): ContextLoadResult {
    return new ContextLoadResult(false, undefined, message);
  }
}
