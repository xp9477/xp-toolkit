import { ensureBridge, loadConfig, localRequest } from '../src/runtime.mjs';
const command = process.argv[2];
try {
  let result;
  if (command === 'login') result = await localRequest(await ensureBridge(), '/open');
  else if (command === 'status') result = await localRequest(await ensureBridge(), '/health');
  else if (command === 'stop') result = await localRequest(loadConfig(), '/stop');
  else { console.error('Usage: node scripts/cli.mjs login|status|stop'); process.exitCode = 2; }
  if (result?.error) throw new Error(result.error);
  if (result) console.log(JSON.stringify(result, null, 2));
} catch { console.error('专用浏览器不可用。检查 Chrome 是否安装；缺少运行时则运行 npm run install-runtime。请勿发送密码或 Cookie。'); process.exitCode = 1; }
