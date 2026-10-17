import { ensureBridge, loadConfig, localRequest } from '../src/runtime.mjs';
const command = process.argv[2];
try {
  if (command === 'pair') {
    const config = await ensureBridge();
    // Explicit user invocation is the only place the local pairing token is displayed.
    console.log('请在 Chrome 扩展的设置页输入下列本机配对码（不是 Linux.do Cookie）：');
    console.log(config.token);
    console.log('然后点击“保存并连接”，在 Chrome 中自行登录 Linux.do。不要分享此配对码。');
  } else if (command === 'status') console.log(JSON.stringify(await localRequest(loadConfig(), '/health'), null, 2));
  else if (command === 'stop') console.log(JSON.stringify(await localRequest(loadConfig(), '/stop')));
  else { console.error('Usage: node scripts/cli.mjs pair|status|stop'); process.exitCode = 2; }
} catch { console.error('本地桥接不可用。运行 pair 启动，或检查 47831 端口及配对设置。'); process.exitCode = 1; }
