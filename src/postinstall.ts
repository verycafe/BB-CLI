import {spawnSync} from "node:child_process";
import process from "node:process";

type InstallStep = {
  command: string;
  args: string[];
};

type InstallPlan = {
  label: string;
  steps: InstallStep[];
  manualCommand: string;
};

const shouldSkip = process.env.BBCLI_SKIP_MPV_INSTALL === "1";
const shouldForce = process.env.BBCLI_FORCE_MPV_INSTALL === "1";
const isDryRun = process.env.BBCLI_MPV_INSTALL_DRY_RUN === "1";
const isGlobalInstall = process.env.npm_config_global === "true";
const isCi = process.env.CI === "true";

main();

function main(): void {
  if (shouldSkip) {
    log("已通过 BBCLI_SKIP_MPV_INSTALL=1 跳过 mpv 自动安装。");
    return;
  }

  if (!shouldForce && !isGlobalInstall) {
    return;
  }

  if (!shouldForce && isCi) {
    log("检测到 CI 环境，跳过 mpv 自动安装。");
    return;
  }

  if (hasCommand("mpv")) {
    log("检测到已安装 mpv，跳过自动安装。");
    return;
  }

  const plan = detectInstallPlan();
  if (!plan) {
    printManualHint();
    return;
  }

  log(`检测到未安装 mpv，准备通过 ${plan.label} 自动安装。`);

  if (isDryRun) {
    log(`干跑模式：将执行 ${plan.steps.map(formatStep).join(" && ")}`);
    return;
  }

  for (const step of plan.steps) {
    log(`执行：${formatStep(step)}`);
    const result = spawnSync(step.command, step.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    if (result.status !== 0) {
      log(`自动安装 mpv 失败，退出码 ${result.status ?? 1}。`);
      log(`你可以手动执行：${plan.manualCommand}`);
      return;
    }
  }

  if (hasCommand("mpv")) {
    log("mpv 安装完成。");
    return;
  }

  log("安装命令已经执行，但当前终端仍未检测到 mpv。");
  log(`你可以手动执行：${plan.manualCommand}`);
}

function detectInstallPlan(): InstallPlan | undefined {
  if (process.platform === "darwin" && hasCommand("brew")) {
    return {
      label: "Homebrew",
      steps: [
        {
          command: "brew",
          args: ["install", "mpv", "ffmpeg"],
        },
      ],
      manualCommand: "brew install mpv ffmpeg",
    };
  }

  const privilegedPrefix = getPrivilegedPrefix();
  if (process.platform !== "linux" || !privilegedPrefix) {
    return undefined;
  }

  if (hasCommand("apt-get")) {
    return buildLinuxPlan("APT", privilegedPrefix, "apt-get", ["install", "-y", "mpv", "ffmpeg"]);
  }

  if (hasCommand("dnf")) {
    return buildLinuxPlan("DNF", privilegedPrefix, "dnf", ["install", "-y", "mpv", "ffmpeg"]);
  }

  if (hasCommand("pacman")) {
    return buildLinuxPlan("Pacman", privilegedPrefix, "pacman", ["-S", "--noconfirm", "mpv", "ffmpeg"]);
  }

  if (hasCommand("zypper")) {
    return buildLinuxPlan("Zypper", privilegedPrefix, "zypper", ["--non-interactive", "install", "mpv", "ffmpeg"]);
  }

  return undefined;
}

function buildLinuxPlan(
  label: string,
  prefix: string[],
  command: string,
  args: string[],
): InstallPlan {
  const steps = [
    {
      command: prefix[0] ?? command,
      args: prefix.length > 0 ? [...prefix.slice(1), command, ...args] : args,
    },
  ];

  const manualCommand = [...prefix, command, ...args].join(" ");
  return {
    label,
    steps,
    manualCommand,
  };
}

function getPrivilegedPrefix(): string[] | undefined {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return [];
  }

  if (hasCommand("sudo")) {
    return ["sudo"];
  }

  return undefined;
}

function hasCommand(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  return result.status === 0;
}

function formatStep(step: InstallStep): string {
  return [step.command, ...step.args].join(" ");
}

function printManualHint(): void {
  log("当前没找到可自动安装 mpv 的包管理器。");
  if (process.platform === "darwin") {
    log("请先安装 Homebrew，然后执行：brew install mpv ffmpeg");
    return;
  }

  if (process.platform === "linux") {
    log("请用系统包管理器安装 mpv 和 ffmpeg，然后再运行 bbcli。");
    return;
  }

  log("当前系统暂不支持自动安装 mpv，请手动安装后再运行 bbcli。");
}

function log(message: string): void {
  console.error(`bbcli 安装：${message}`);
}
