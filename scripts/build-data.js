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
const LANGUAGES = [
  'en', 'af', 'id', 'ms', 'cs', 'da', 'de', 'es', 'fil', 'fr',
  'hr', 'it', 'sw', 'hu', 'nl', 'nb', 'uz', 'pl', 'pt', 'ro',
  'sk', 'fi', 'sv', 'vi', 'tr', 'el', 'bg', 'be', 'ky', 'kk',
  'ru', 'sr', 'uk', 'iw', 'ar', 'fa', 'ur', 'am', 'mr', 'ne',
  'hi', 'bn', 'ta', 'te', 'si', 'th', 'lo', 'my', 'km', 'ko',
  'ja', 'zh-CN', 'zh-TW', 'zh-HK'
];

// Bản đồ ánh xạ ngôn ngữ sang quốc gia để lấy đúng rating/dữ liệu của từng vùng
const LANG_TO_COUNTRY = {
  'vi': 'vn', 'ja': 'jp', 'ko': 'kr', 'zh-CN': 'cn', 'zh-TW': 'tw', 'zh-HK': 'hk',
  'ru': 'ru', 'sr': 'rs', 'uk': 'ua', 'iw': 'il', 'ar': 'ae', 'fa': 'ir',
  'ur': 'pk', 'am': 'et', 'mr': 'in', 'ne': 'np', 'hi': 'in', 'bn': 'bd',
  'ta': 'in', 'te': 'in', 'si': 'lk', 'th': 'th', 'lo': 'la', 'my': 'mm',
  'km': 'kh', 'en': 'us', 'af': 'za', 'id': 'id', 'ms': 'my', 'cs': 'cz',
  'da': 'dk', 'de': 'de', 'es': 'es', 'fil': 'ph', 'fr': 'fr', 'hr': 'hr',
  'it': 'it', 'sw': 'ke', 'hu': 'hu', 'nl': 'nl', 'nb': 'no', 'uz': 'uz',
  'pl': 'pl', 'pt': 'pt', 'ro': 'ro', 'sk': 'sk', 'fi': 'fi', 'sv': 'se',
  'tr': 'tr', 'el': 'gr', 'bg': 'bg', 'be': 'by', 'ky': 'kg', 'kk': 'kz'
};

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
  const skipImages = process.argv.includes('--no-images');
  
  try {
    if (skipImages) {
      console.log('🧹 Chế độ --no-images: Bỏ qua việc xóa và tải lại icon mới...');
      await fs.ensureDir(ICONS_DIR);
    } else {
      console.log('🧹 Đang dọn dẹp dữ liệu cũ (Xóa icon cũ, cache cũ)...');
      // Xóa sạch thư mục icon và tạo lại trống
      await fs.emptyDir(ICONS_DIR);
    }

    
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
      console.log(`  - Đang tải đồng thời ${LANGUAGES.length} ngôn ngữ...`);
      
      const appDataItem = {
        id: appId,
        iconLocal: `images/icons/${appId}.png`,
        locales: {}
      };

      let iconUrl = null;

      // Hàm fetch cho 1 ngôn ngữ với cơ chế tự động thử lại
      const fetchLangWithRetry = async (lang) => {
        let attempt = 0;
        const maxRetries = 3; // Thử tối đa 3 lần
        while (attempt < maxRetries) {
          try {
            const appInfo = await gplay.app({ 
              appId, 
              lang: lang, 
              country: LANG_TO_COUNTRY[lang] || 'us' 
            });
            return { lang, success: true, data: appInfo };
          } catch (err) {
            attempt++;
            if (attempt >= maxRetries) {
              console.error(`  [X] Thất bại hoàn toàn cho ${lang.toUpperCase()} sau ${maxRetries} lần thử.`);
              return { lang, success: false, error: err };
            }
            console.log(`  [!] Lỗi lấy ${lang.toUpperCase()} (Lần ${attempt}/${maxRetries}). Tự động thử lại sau 2s...`);
            await delay(2000); // Đợi 2s trước khi thử lại
          }
        }
      };

      // Gửi toàn bộ request của 1 app cùng lúc
      const fetchPromises = LANGUAGES.map(lang => fetchLangWithRetry(lang));
      const results = await Promise.all(fetchPromises);

      // Xử lý kết quả trả về
      for (const res of results) {
        if (res.success && res.data) {
          appDataItem.locales[res.lang] = res.data;
          if (!iconUrl && res.data.icon) {
            iconUrl = res.data.icon;
          }
        }
      }

      // Tải icon nếu có URL và không ở chế độ skipImages
      if (iconUrl && !skipImages) {
        const iconFileName = `${appId}.png`;
        await downloadIcon(iconUrl, iconFileName);
        console.log(`  ✓ Đã tải icon mới: ${iconFileName}`);
      } else if (iconUrl && skipImages) {
        console.log(`  ✓ Bỏ qua tải icon: ${appId}.png`);
      }

      // Chỉ thêm vào danh sách nếu lấy thành công ít nhất 1 ngôn ngữ (Tránh lỗi khi app bị xóa khỏi store hoặc gõ sai ID)
      if (Object.keys(appDataItem.locales).length > 0) {
        allAppsData[appId] = appDataItem;
        console.log(`  ✓ Đã tải xong ${Object.keys(appDataItem.locales).length}/${LANGUAGES.length} ngôn ngữ cho ${appId}`);
      } else {
        console.log(`  [!] Bỏ qua ${appId} vì không tồn tại hoặc lỗi mạng tất cả ngôn ngữ.`);
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
