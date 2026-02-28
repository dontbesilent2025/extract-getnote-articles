const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 从URL或直接的ID中提取知识库ID
function extractTopicId(urlOrId) {
  // 如果是URL，提取ID
  const urlMatch = urlOrId.match(/subject\/([^\/\?]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  // 否则假设就是ID
  return urlOrId;
}

// 从URL中提取followName参数
function extractFollowName(url) {
  try {
    const urlObj = new URL(url);
    const followName = urlObj.searchParams.get('followName');
    if (followName) {
      // URL解码
      return decodeURIComponent(followName);
    }
  } catch (e) {
    // 不是有效的URL
  }
  return null;
}

// 检查输入是否为完整URL
function isFullUrl(input) {
  return input.startsWith('http://') || input.startsWith('https://');
}

// 获取输出目录（复用已有目录以支持增量抓取）
function getOutputDir(baseName) {
  return `./${baseName}`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('❌ 错误：请提供知识库URL或ID');
    console.log('');
    console.log('用法：');
    console.log('  node run.js <URL或ID> [输出目录]');
    console.log('');
    console.log('示例：');
    console.log('  node run.js https://www.biji.com/subject/ABC123/DEFAULT?followName=...');
    console.log('  node run.js ABC123');
    console.log('  node run.js ABC123 "自定义目录名"');
    process.exit(1);
  }

  const urlOrId = args[0];
  const topicId = extractTopicId(urlOrId);

  // 确定输出目录名：优先使用用户指定的，其次使用followName，最后使用topicId
  let outputDirName;
  if (args[1]) {
    outputDirName = args[1];
  } else {
    const followName = extractFollowName(urlOrId);
    outputDirName = followName || topicId;
  }

  // 获取输出目录（复用已有目录以支持增量抓取）
  const outputDir = getOutputDir(outputDirName);
  const finalDirName = path.basename(outputDir);

  console.log('=== Get笔记文案提取工具 ===');
  console.log(`输入: ${urlOrId}`);
  console.log(`知识库ID: ${topicId}`);
  console.log(`输出目录: ${finalDirName}`);
  console.log('');

  // 调用原始的 extract.js
  // 如果是完整URL，传递完整URL；否则只传递ID
  const { spawn } = require('child_process');
  const extract = spawn('node', ['extract.js', urlOrId, outputDir, '0', '0'], {
    stdio: 'inherit',
    cwd: __dirname
  });

  extract.on('close', (code) => {
    process.exit(code);
  });
}

main().catch(console.error);
