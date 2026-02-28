const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES = [
  {
    name: '__snaker__id',
    value: 'HOeqYGrC5tNHco7F',
    domain: 'www.biji.com',
    path: '/subject/oJOKRwOJ',
    expires: Math.floor(new Date('2027-02-14').getTime() / 1000)
  },
  {
    name: 'acw_tc',
    value: '2f6fc15817710759836881109e008a7ff7d317cea0773b5e6ae8116b055597',
    domain: 'www.biji.com',
    path: '/',
    expires: Math.floor(new Date('2026-02-14').getTime() / 1000),
    httpOnly: true
  },
  {
    name: 'aliyungf_tc',
    value: 'd5ae3186cbb59d27718c8c45b95063d9082f5b3dd2620d5cfe3e783645389fc2',
    domain: 'www.biji.com',
    path: '/',
    httpOnly: true
  },
  {
    name: 'csrfToken',
    value: 'kFPzr2cA6kqcbbz6bmVtEldP',
    domain: 'www.biji.com',
    path: '/'
  },
  {
    name: 'gdxidpyhxdE',
    value: '1ZuOzkztq7687K5CsIXDXmIP86IO99pQCT7PcrBXD7Cp%2BhQR%5C8TD4IVbZo3CWcyHvxc6hOLONgcCn3q2rOrZOJm3U5s4jQ6qNa7jlMCz8zLTMXNgLbWoia8IJTLMoTmV4G28q89JQ23R9%5CA3kU6vNRGMrsLCTsdQoTOTHtCqN373ssIn%3A1771076978713',
    domain: 'www.biji.com',
    path: '/',
    expires: Math.floor(new Date('2026-03-16').getTime() / 1000)
  },
  {
    name: 'ISID',
    value: '0589fc434d7a236b7f8dc7123206e85a',
    domain: '.biji.com',
    path: '/',
    expires: Math.floor(new Date('2027-02-14').getTime() / 1000),
    httpOnly: true
  }
];

// 连续跳过多少篇后提前终止（认为后续都是旧内容）
const CONSECUTIVE_SKIP_THRESHOLD = 10;

function sanitizeFilename(title) {
  return title.replace(/[<>:"/\\|?*#]/g, '').substring(0, 100).trim();
}

// === Manifest 相关 ===

function getManifestPath(outputDir) {
  return path.join(outputDir, '.manifest.json');
}

function readManifest(outputDir) {
  const manifestPath = getManifestPath(outputDir);
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
      console.log('⚠️  manifest 文件损坏，重新初始化');
    }
  }
  return { lastRun: null, articles: {} };
}

function writeManifest(outputDir, manifest) {
  const manifestPath = getManifestPath(outputDir);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// 获取输出目录中已有文件的最大编号
function getMaxFileIndex(outputDir) {
  if (!fs.existsSync(outputDir)) return 0;
  const files = fs.readdirSync(outputDir);
  let maxIndex = 0;
  for (const file of files) {
    const match = file.match(/^(\d{3})_/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxIndex) maxIndex = num;
    }
  }
  return maxIndex;
}

async function extractArticleContent(page, detailUrl) {
  try {
    const webUrl = detailUrl + '/web';

    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // 智能等待：等待段落出现即可
    await page.waitForSelector('p', { timeout: 5000 }).catch(() => {});

    const content = await page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('p'));
      let title = '';
      let originalLink = '';
      let contentParts = [];

      for (let p of paragraphs) {
        const text = p.textContent.trim();
        if (text.startsWith('原链接：')) {
          originalLink = text.replace('原链接：', '');
        } else if (!title && text.length > 0 && text.length < 200) {
          title = text;
        } else if (text.length > 50) {
          // 收集所有长度超过50的段落
          contentParts.push(text);
        }
      }

      // 将所有段落合并成完整内容
      const mainContent = contentParts.join('\n\n');

      return { title, originalLink, mainContent };
    });

    return content;
  } catch (error) {
    console.error(`      ✗ 提取失败: ${error.message}`);
    return null;
  }
}

// 串行获取文章URL（通过点击）
async function fetchArticleUrls(page, baseUrl, articles, currentPage) {
  const urls = [];

  for (let i = 0; i < articles.length; i++) {
    try {
      // 返回列表页
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('tbody tr', { timeout: 5000 });
      await page.waitForTimeout(1000);

      // 如果不是第一页，需要翻页
      if (currentPage > 1) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        const pageUrl = `${baseUrl}${separator}page=${currentPage}`;
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('tbody tr', { timeout: 5000 });
        await page.waitForTimeout(1000);
      }

      // 点击第i行
      await page.evaluate((index) => {
        const rows = document.querySelectorAll('tbody tr');
        if (rows[index]) {
          const titleCell = rows[index].querySelector('td:first-child');
          if (titleCell) {
            titleCell.click();
          }
        }
      }, i);

      // 等待页面跳转
      await page.waitForTimeout(1500);
      const url = page.url();

      urls.push({
        ...articles[i],
        detailUrl: url
      });

      console.log(`  [${i + 1}/${articles.length}] 获取URL: ${articles[i].title.substring(0, 30)}...`);
    } catch (error) {
      console.error(`  [${i + 1}/${articles.length}] 获取URL失败: ${error.message}`);
      urls.push({
        ...articles[i],
        detailUrl: null
      });
    }
  }

  return urls;
}

// 并行处理单篇文章
async function processArticle(context, article, outputDir, globalIndex, startTime, totalSavedRef, manifest) {
  // 先查 manifest 是否已抓过该 URL
  if (article.detailUrl && manifest.articles[article.detailUrl]) {
    console.log(`  [${globalIndex}] ⏭️  ${article.title.substring(0, 40)}... - manifest 已记录，跳过`);
    return { skipped: true, saved: false };
  }

  const filename = `${String(globalIndex).padStart(3, '0')}_${sanitizeFilename(article.title)}.md`;
  const filepath = path.join(outputDir, filename);

  // 文件存在性检查作为兜底
  if (fs.existsSync(filepath)) {
    console.log(`  [${globalIndex}] ⏭️  ${article.title.substring(0, 40)}... - 文件已存在，跳过`);
    return { skipped: true, saved: false };
  }

  // 检查是否有有效的URL
  if (!article.detailUrl) {
    console.log(`  [${globalIndex}] ✗ ${article.title.substring(0, 40)}... - 无有效URL`);
    return { skipped: false, saved: false };
  }

  try {
    console.log(`  [${globalIndex}] 🔄 ${article.title.substring(0, 40)}...`);

    // 为每个文章创建独立的页面
    const page = await context.newPage();

    try {
      const content = await extractArticleContent(page, article.detailUrl);

      if (content && content.mainContent) {
        const markdown = `# ${article.title}

**原链接**: ${content.originalLink || ''}

---

${content.mainContent}
`;

        fs.writeFileSync(filepath, markdown, 'utf-8');
        totalSavedRef.count++;

        // 写入 manifest
        manifest.articles[article.detailUrl] = {
          title: article.title,
          file: filename,
          scrapedAt: new Date().toISOString()
        };
        writeManifest(outputDir, manifest);

        // 计算并显示实时统计
        const elapsedMinutes = (Date.now() - startTime) / 1000 / 60;
        const avgSpeed = totalSavedRef.count / elapsedMinutes;
        console.log(`  [${globalIndex}] ✓ ${article.title.substring(0, 40)}... - 已保存 (${avgSpeed.toFixed(1)} 篇/分钟)`);

        await page.close();
        return { skipped: false, saved: true };
      } else {
        console.log(`  [${globalIndex}] ✗ ${article.title.substring(0, 40)}... - 内容为空`);
        await page.close();
        return { skipped: false, saved: false };
      }
    } catch (error) {
      console.error(`  [${globalIndex}] ✗ ${article.title.substring(0, 40)}... - 处理失败: ${error.message}`);
      await page.close();
      return { skipped: false, saved: false };
    }
  } catch (error) {
    console.error(`  [${globalIndex}] ✗ ${article.title.substring(0, 40)}... - 创建页面失败: ${error.message}`);
    return { skipped: false, saved: false };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const urlOrId = args[0] || 'oJOKRwOJ';
  const outputDir = args[1] || '于生文案_完整版';
  const maxPages = parseInt(args[2] || '0');
  const maxArticles = parseInt(args[3] || '0');
  const concurrency = parseInt(args[4] || '3'); // 并发数，默认3

  // 判断是完整URL还是只是ID
  let baseUrl;
  let topicId;

  if (urlOrId.startsWith('http://') || urlOrId.startsWith('https://')) {
    // 完整URL，直接使用
    baseUrl = urlOrId;
    // 从URL中提取topicId用于显示
    const match = urlOrId.match(/subject\/([^\/\?]+)/);
    topicId = match ? match[1] : 'unknown';
  } else {
    // 只是ID，构造URL
    topicId = urlOrId;
    baseUrl = `https://www.biji.com/subject/${topicId}/DEFAULT`;
  }

  console.log('=== Get笔记文案提取工具 ===');
  console.log(`知识库ID: ${topicId}`);
  console.log(`输出目录: ${outputDir}`);
  console.log(`最大页数: ${maxPages === 0 ? '全部' : maxPages}`);
  console.log(`最大文章数: ${maxArticles === 0 ? '全部' : maxArticles}`);
  console.log(`并发数: ${concurrency}`);
  console.log('');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 读取 manifest（增量抓取状态）
  const manifest = readManifest(outputDir);
  const manifestCount = Object.keys(manifest.articles).length;
  if (manifestCount > 0) {
    console.log(`📋 manifest 中已有 ${manifestCount} 篇文章记录，将进行增量抓取`);
  }
  manifest.lastRun = new Date().toISOString();

  // 获取已有文件的最大编号，新文章接续编号
  let nextIndex = getMaxFileIndex(outputDir) + 1;

  // 记录开始时间
  const startTime = Date.now();

  console.log('启动浏览器...');
  const userDataDir = path.join(__dirname, 'chrome-user-data');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-features=FocusOnLoad',
      '--disable-popup-blocking',
      '--disable-background-timer-throttling',
      '--window-position=0,0',  // 固定位置
      '--window-size=800,600'   // 较小窗口
    ],
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  const page = await context.newPage();

  // 优雅停止处理
  let shouldStop = false;
  const gracefulShutdown = async () => {
    if (shouldStop) return; // 防止重复调用
    shouldStop = true;
    console.log('\n\n⚠️  收到停止信号，正在优雅退出...');
    console.log('等待当前批次处理完成...');
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // 使用对象引用来跟踪计数（用于并行处理）
  const totalSavedRef = { count: 0 };
  let totalSkipped = 0;
  let consecutiveSkips = 0;
  let currentPage = 1;

  while (maxPages === 0 || currentPage <= maxPages) {
    console.log(`\n处理第 ${currentPage} 页...`);

    try {
      // 使用URL参数进行分页
      let pageUrl;
      if (currentPage === 1) {
        pageUrl = baseUrl;
      } else {
        // 检查baseUrl是否已经有查询参数
        const separator = baseUrl.includes('?') ? '&' : '?';
        pageUrl = `${baseUrl}${separator}page=${currentPage}`;
      }
      console.log(`访问: ${pageUrl}`);

      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('页面已加载，等待内容...');

      // 添加更长的等待时间，让页面完全渲染
      await page.waitForTimeout(3000);

      // 等待表格出现
      try {
        await page.waitForSelector('tbody tr', { timeout: 10000 });
        console.log('表格已出现');
      } catch (e) {
        console.log('未找到表格，检查页面状态...');
        console.log('当前URL:', page.url());
        console.log('页面标题:', await page.title());

        // 检查是否需要登录
        const needsLogin = await page.evaluate(() => {
          return document.body.innerText.includes('登录') || document.body.innerText.includes('请先登录');
        });

        if (needsLogin) {
          console.log('\n⚠️  需要登录！');
          console.log('==================================================');
          console.log('请在打开的浏览器窗口中登录 Get笔记账号');
          console.log('==================================================');
          console.log('');
          console.log('步骤：');
          console.log('1. 查看自动打开的浏览器窗口');
          console.log('2. 在浏览器中登录 www.biji.com');
          console.log('3. 登录成功后，脚本会自动继续');
          console.log('');
          console.log('等待登录中（最多60秒）...');
          console.log('');

          // 在浏览器中显示提示
          await page.evaluate(() => {
            document.body.innerHTML = `
              <div style="
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              ">
                <div style="
                  background: white;
                  padding: 40px;
                  border-radius: 20px;
                  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                  text-align: center;
                  max-width: 500px;
                ">
                  <h1 style="color: #667eea; margin-bottom: 20px;">⚠️ 需要登录</h1>
                  <p style="font-size: 18px; color: #333; margin-bottom: 30px;">
                    请点击下方按钮前往 Get笔记 登录
                  </p>
                  <a href="https://www.biji.com"
                     style="
                       display: inline-block;
                       background: #667eea;
                       color: white;
                       padding: 15px 40px;
                       border-radius: 10px;
                       text-decoration: none;
                       font-size: 18px;
                       font-weight: bold;
                     ">
                    前往登录
                  </a>
                  <p style="font-size: 14px; color: #666; margin-top: 30px;">
                    登录成功后，脚本会自动继续提取文章
                  </p>
                </div>
              </div>
            `;
          });

          // 等待60秒让用户登录
          await page.waitForTimeout(60000);

          // 重新加载页面
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          try {
            await page.waitForSelector('tbody tr', { timeout: 10000 });
            console.log('✅ 登录成功，表格已出现');
          } catch (e2) {
            console.log('\n❌ 登录超时或失败');
            console.log('请确保已在浏览器中完成登录，然后重新运行脚本');
            await context.close();
            process.exit(1);
          }
        } else {
          throw e;
        }
      }

      // 一次性提取所有文章信息（标题）
      const articles = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        return Array.from(rows).map((row, index) => {
          const titleCell = row.querySelector('td:first-child');
          const title = titleCell ? titleCell.textContent.trim() : null;
          return { title, index };
        }).filter(item => item.title);
      });

      console.log(`找到 ${articles.length} 篇文案`);

      if (articles.length === 0) {
        if (currentPage === 1) {
          console.log('没有找到文案，可能需要登录');
          console.log('当前页面标题:', await page.title());
          console.log('当前URL:', page.url());
        } else {
          console.log('没有更多文章了，已到达最后一页');
        }
        break;
      }

      // 步骤1：串行获取所有文章的URL
      console.log('\n📋 步骤1: 获取文章URL...');
      const articlesWithUrls = await fetchArticleUrls(page, pageUrl, articles, currentPage);

      // 步骤2：并行提取文章内容（分批处理）
      console.log('\n📝 步骤2: 并行提取内容...');
      let earlyStop = false;
      for (let i = 0; i < articlesWithUrls.length; i += concurrency) {
        // 检查是否收到停止信号
        if (shouldStop) {
          console.log('\n⏸️  停止提取，保存进度...');
          break;
        }

        // 检查是否达到最大文章数
        if (maxArticles > 0 && totalSavedRef.count >= maxArticles) {
          console.log(`\n已达到最大文章数限制 (${maxArticles})，停止提取`);
          break;
        }

        // 检查连续跳过是否达到阈值
        if (consecutiveSkips >= CONSECUTIVE_SKIP_THRESHOLD) {
          console.log(`\n⏩ 连续跳过 ${consecutiveSkips} 篇已抓取文章，后续内容视为旧内容，提前停止`);
          earlyStop = true;
          break;
        }

        // 获取当前批次的文章
        const batch = articlesWithUrls.slice(i, Math.min(i + concurrency, articlesWithUrls.length));

        // 并行处理当前批次，使用接续编号
        const promises = batch.map((article, batchIndex) => {
          const globalIndex = nextIndex + batchIndex;
          return processArticle(context, article, outputDir, globalIndex, startTime, totalSavedRef, manifest);
        });

        const results = await Promise.all(promises);

        // 统计结果，更新连续跳过计数器和编号
        let savedInBatch = 0;
        results.forEach(result => {
          if (result.skipped) {
            totalSkipped++;
            consecutiveSkips++;
          } else {
            consecutiveSkips = 0;
            if (result.saved) savedInBatch++;
          }
        });

        // 只有实际保存了文章才推进编号
        nextIndex += savedInBatch;
      }

      // 检查是否收到停止信号或提前终止
      if (shouldStop || earlyStop) {
        break;
      }

      currentPage++;

    } catch (error) {
      console.error(`处理第 ${currentPage} 页失败: ${error.message}`);
      break;
    }
  }

  // 保存最终 manifest
  writeManifest(outputDir, manifest);

  await context.close();

  // 计算最终统计
  const totalMinutes = (Date.now() - startTime) / 1000 / 60;
  const finalSpeed = totalSavedRef.count / totalMinutes;

  console.log('\n=== 完成 ===');
  console.log(`总共保存: ${totalSavedRef.count} 篇文案`);
  if (totalSkipped > 0) {
    console.log(`跳过已存在: ${totalSkipped} 篇`);
  }
  console.log(`总用时: ${totalMinutes.toFixed(1)} 分钟`);
  console.log(`平均速度: ${finalSpeed.toFixed(1)} 篇/分钟`);
  console.log(`输出目录: ${outputDir}`);
}

main().catch(console.error);
