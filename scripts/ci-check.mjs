import { spawnSync } from 'node:child_process';
import process from 'node:process';

const defaultDbUrl = 'postgresql://ci:ci@127.0.0.1:5432/ci?schema=public';
if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = defaultDbUrl;
}

function run(label, command, args) {
  process.stderr.write(`\n[ci-check] ${label}\n`);
  const r = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  if (r.status !== 0) {
    process.stderr.write(`\n[ci-check] Falhou: ${label}\n`);
    process.exit(r.status ?? 1);
  }
}

run('Prisma generate', 'npx', ['prisma', 'generate']);
run('Prisma validate', 'npx', ['prisma', 'validate']);
run('Prisma format --check', 'npx', ['prisma', 'format', '--check']);
run('Prettier --check', 'yarn', ['format:check']);
run('ESLint', 'yarn', ['lint']);
run('TypeScript (eslint project)', 'yarn', ['typecheck:all']);
run('Vitest', 'yarn', ['test']);
run('Build tsc', 'yarn', ['build']);

const skipDocker =
  process.env.SKIP_DOCKER === '1' ||
  process.env.SKIP_DOCKER === 'true' ||
  process.env.SKIP_DOCKER === 'yes';

if (skipDocker) {
  process.stderr.write(
    '\n[ci-check] SKIP_DOCKER definido — build Docker omitido (o CI no GitHub ainda executa).\n',
  );
  process.exit(0);
}

const dockerVersion = spawnSync('docker', ['version'], { stdio: 'ignore' });
if (dockerVersion.error && 'code' in dockerVersion.error && dockerVersion.error.code === 'ENOENT') {
  process.stderr.write(
    '\n[ci-check] Docker não instalado — pulando build de imagem (o job docker-image ainda roda no GitHub Actions).\n',
  );
  process.exit(0);
}

const dockerInfo = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (dockerInfo.status !== 0) {
  process.stderr.write(
    '\n[ci-check] Docker está instalado mas o daemon não responde (docker info falhou). Inicie o Docker ou use SKIP_DOCKER=1 para pular só o build local.\n',
  );
  process.exit(1);
}

run('Docker build (target build)', 'docker', [
  'build',
  '--target',
  'build',
  '-t',
  'finance-zap:precommit',
  '.',
]);

process.stderr.write('\n[ci-check] Todas as verificações passaram.\n');
