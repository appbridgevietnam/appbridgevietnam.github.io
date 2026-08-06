const gplayModule = require('google-play-scraper');
const gplay = gplayModule.default || gplayModule;
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Danh sách các App ID (Bao gồm các app bạn mới đưa và các app cũ trên web)
const MY_APP_IDS = [
  'com.appbridge.simplestreak',
  'vn.lecon.smart_todo_list',
  'app.bridge.shoppinglist',
  'com.appbridgevietnam.expiryreminder',
  'vn.lecon.system.fastchargechecker',
  'com.appbridge.appusagestatistics',
  'app.bridge.breakbadgabits',
  'vn.lecon.device.info',
];

// Danh sách các Ứng dụng nổi bật (Featured Apps)
const FEATURED_APP_IDS = [
  'vn.lecon.system.fastchargechecker',
  'com.appbridgevietnam.expiryreminder',
];

// Danh sách ngôn ngữ muốn lấy dữ liệu
const LANGUAGES = ['vi', 'en'];

// Cấu hình đường dẫn thư mục
const PROJECT_ROOT = path.join(__dirname, '..');
const ICONS_DIR = path.join(PROJECT_ROOT, 'images', 'icons');
const JS_OUTPUT = path.join(PROJECT_ROOT, 'js', 'apps-data.js');

// Hàm tải icon về thư mục cục bộ
async function downloadIcon(imageUrl, filename) {
  const filePath = path.join(ICONS_DIR, filename);

  const writer = fs.createWriteStream(filePath);

  const response = await axios({
    url: imageUrl,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Hàm tạm dừng (tránh bị Google chặn IP)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function buildAppsData() {
  try {
    console.log('🧹 Đang dọn dẹp dữ liệu cũ (Xóa icon cũ, cache cũ)...');
    // Xóa sạch thư mục icon và tạo lại trống
    await fs.emptyDir(ICONS_DIR);
    
    // Đảm bảo thư mục js tồn tại
    await fs.ensureDir(path.dirname(JS_OUTPUT));
    
    // Xóa file js cũ nếu có
    if (await fs.pathExists(JS_OUTPUT)) {
      await fs.remove(JS_OUTPUT);
    }

    console.log('⏳ Bắt đầu lấy dữ liệu đa ngôn ngữ và tải icon từ Google Play...');

    const allAppsData = {};
    const allAppIds = Array.from(new Set([...MY_APP_IDS, ...FEATURED_APP_IDS]));

    for (const appId of allAppIds) {
      console.log(`\n▶ Đang xử lý: ${appId}`);
      
      const appDataItem = {
        id: appId,
        iconLocal: `images/icons/${appId}.png`,
        locales: {}
      };

      let iconUrl = null;

      // Lặp qua từng ngôn ngữ
      for (const lang of LANGUAGES) {
        try {
          console.log(`  - Fetching [${lang.toUpperCase()}]...`);
          // Cào dữ liệu theo ngôn ngữ (ví dụ lang: 'vi', country: 'vn' hoặc 'us')
          const appInfo = await gplay.app({ 
            appId, 
            lang: lang, 
            country: lang === 'vi' ? 'vn' : 'us' 
          });

          // Lưu toàn bộ dữ liệu vào trường locales
          appDataItem.locales[lang] = appInfo;
          
          // Lấy URL icon từ bất kỳ ngôn ngữ nào (icon giống nhau)
          if (!iconUrl && appInfo.icon) {
            iconUrl = appInfo.icon;
          }

          // Delay 1.5s giữa các request để an toàn
          await delay(1500);

        } catch (fetchErr) {
          console.error(`  [!] Không thể lấy thông tin cho ${appId} (Ngôn ngữ: ${lang}):`, fetchErr.message);
        }
      }

      // Tải icon nếu có URL
      if (iconUrl) {
        const iconFileName = `${appId}.png`;
        await downloadIcon(iconUrl, iconFileName);
        console.log(`  ✓ Đã tải icon mới: ${iconFileName}`);
      }

      // Chỉ thêm vào danh sách nếu lấy thành công ít nhất 1 ngôn ngữ (Tránh lỗi khi app bị xóa khỏi store hoặc gõ sai ID)
      if (Object.keys(appDataItem.locales).length > 0) {
        allAppsData[appId] = appDataItem;
      } else {
        console.log(`  [!] Bỏ qua ${appId} vì không tồn tại hoặc lỗi mạng.`);
      }
    }

    // Lọc lại dữ liệu theo đúng danh sách ban đầu
    const appsData = MY_APP_IDS.map(id => allAppsData[id]).filter(Boolean);
    const featuredAppsData = FEATURED_APP_IDS.map(id => allAppsData[id]).filter(Boolean);

    // Xuất ra file JavaScript (.js)
    const fileContent = `// File này được sinh tự động bởi lệnh: npm run update-apps\n\nconst APPS_DATA = ${JSON.stringify(appsData, null, 2)};\n\nconst FEATURED_APPS_DATA = ${JSON.stringify(featuredAppsData, null, 2)};\n`;
    await fs.writeFile(JS_OUTPUT, fileContent, 'utf-8');
    
    console.log(`\n🎉 Thành công! Đã lưu dữ liệu đa ngôn ngữ tại: ${JS_OUTPUT}`);
    console.log(`💡 File JS hiện chứa 2 biến: APPS_DATA và FEATURED_APPS_DATA`);

  } catch (error) {
    console.error('\n❌ Có lỗi xảy ra trong quá trình build:', error);
  }
}

buildAppsData();
