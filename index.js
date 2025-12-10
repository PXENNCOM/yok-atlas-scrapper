const puppeteer = require('puppeteer');
const fs = require('fs');

// Bekleme fonksiyonu
const bekle = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// TEK PARALEL İŞLEM (En stabil)
const PARALEL_ISLEM_SAYISI = 1;

// CHECKPOINT DOSYALARI
const CHECKPOINT_FILE = 'checkpoint.json';
const DATA_FILE = 'tum_veri_3_yil.json';
const LOG_FILE = 'scraper_log.txt';

// Log fonksiyonu
function logYaz(mesaj) {
  const zaman = new Date().toLocaleString('tr-TR');
  const logMesaj = `[${zaman}] ${mesaj}\n`;
  console.log(mesaj);
  fs.appendFileSync(LOG_FILE, logMesaj, 'utf-8');
}

// Checkpoint kaydet
function checkpointKaydet(islenenBolumler, tumSonuclar) {
  const checkpoint = {
    islenenBolumler: islenenBolumler,
    toplamKayit: tumSonuclar.length,
    sonGuncelleme: new Date().toISOString()
  };
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), 'utf-8');
  fs.writeFileSync(DATA_FILE, JSON.stringify(tumSonuclar, null, 2), 'utf-8');
}

// Checkpoint yükle
function checkpointYukle() {
  if (fs.existsSync(CHECKPOINT_FILE) && fs.existsSync(DATA_FILE)) {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    const tumSonuclar = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return { checkpoint, tumSonuclar };
  }
  return null;
}

// Checkpoint temizle
function checkpointTemizle() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
  }
}

async function birBolumIcinVeriCek(browser, bolum, bolumIndex, toplamBolum) {
  const page = await browser.newPage();
  
  // UZUN TIMEOUT (Stabil olması için)
  page.setDefaultTimeout(90000); // 90 saniye
  page.setDefaultNavigationTimeout(90000);
  
  // Gereksiz içerikleri engelle
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.setBypassCSP(true);

  const sonuclar = [];
  let basariliUni = 0;
  let hataliUni = 0;

  try {
    logYaz(`\n[BÖLÜM ${bolumIndex + 1}/${toplamBolum}] ${bolum.text} - Başlatıldı`);

    await page.goto('https://yokatlas.yok.gov.tr/lisans-anasayfa.php', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await bekle(2000); // Uzun bekleme

    await page.click('#flip2 > div > div.face.front.flipControl > div', { timeout: 45000 });
    await bekle(2000);
    await page.select('#bolum', bolum.value);
    await bekle(3000); // Uzun bekleme

    const universiteler = await page.evaluate(() => {
      const universities = [];
      const solListe = document.querySelector('#bs-collapse');
      const sagListe = document.querySelector('#bs-collapse2');
      
      if (solListe) {
        solListe.querySelectorAll('a[href*="lisans.php"]').forEach(link => {
          universities.push({ ad: link.textContent.trim(), url: link.href });
        });
      }
      
      if (sagListe) {
        sagListe.querySelectorAll('a[href*="lisans.php"]').forEach(link => {
          universities.push({ ad: link.textContent.trim(), url: link.href });
        });
      }
      
      return universities;
    });

    logYaz(`[BÖLÜM ${bolumIndex + 1}] ${universiteler.length} üniversite bulundu`);

    // Her üniversite için
    for (let i = 0; i < universiteler.length; i++) {
      const uni = universiteler[i];

      try {
        await page.goto(uni.url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        await bekle(1500);

        const uniDetay = await page.evaluate(() => {
          const nameElement = document.querySelector('.panel-title.pull-left');
          const typeElement = document.querySelector('.panel-title.pull-right');
          
          return {
            name: nameElement ? nameElement.textContent.trim() : 'Bulunamadı',
            type: typeElement ? typeElement.textContent.replace('Üniversite Türü:', '').trim() : 'Bulunamadı'
          };
        });

        const yilVerileri = {
          '2023': { sayi: 'Veri Yok', oran: 'Veri Yok' },
          '2024': { sayi: 'Veri Yok', oran: 'Veri Yok' },
          '2025': { sayi: 'Veri Yok', oran: 'Veri Yok' }
        };

        // Her yıl için veri çek
        for (const yil of ['2023', '2024', '2025']) {
          try {
            const yilLinki = await page.evaluate((targetYear) => {
              const links = document.querySelectorAll('.panel-title.pull-left a');
              for (let link of links) {
                if (link.textContent.includes(`${targetYear} Yılı`)) {
                  return link.href;
                }
              }
              return null;
            }, yil);

            if (yilLinki) {
              await page.goto(yilLinki, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
              });
              await bekle(1500);

              // Accordion'u aç
              const baslikTiklandi = await page.evaluate(() => {
                const panelBasliklari = document.querySelectorAll('.panel-heading');
                for (let baslik of panelBasliklari) {
                  if (baslik.textContent.includes('Yerleşenlerin Mezun Oldukları Lise Grubu')) {
                    const link = baslik.querySelector('a');
                    if (link) {
                      link.click();
                      return true;
                    }
                  }
                }
                return false;
              });

              if (baslikTiklandi) {
                await bekle(4000); // Uzun bekleme - table yüklenmesi için

                const veri = await page.evaluate(() => {
                  const tumTablelar = document.querySelectorAll('table.table-bordered');
                  
                  for (let tablo of tumTablelar) {
                    const satirlar = tablo.querySelectorAll('tbody tr');
                    
                    for (let satir of satirlar) {
                      const hücreler = satir.querySelectorAll('td');
                      
                      if (hücreler.length >= 3) {
                        const liseAdi = hücreler[0].textContent.trim();
                        
                        if (liseAdi.includes('Anadolu İmam Hatip')) {
                          return {
                            bulundu: true,
                            sayi: hücreler[1].textContent.trim(),
                            yuzde: hücreler[2].textContent.trim()
                          };
                        }
                      }
                    }
                  }
                  
                  return { bulundu: false };
                });

                if (veri.bulundu) {
                  yilVerileri[yil] = { sayi: veri.sayi, oran: veri.yuzde };
                } else {
                  yilVerileri[yil] = { sayi: 'Bulunamadı', oran: 'Bulunamadı' };
                }
              }
            }
          } catch (yilHata) {
            // Yıl hatası - sessizce devam et
            yilVerileri[yil] = { sayi: 'Hata', oran: 'Hata' };
          }
        }

        sonuclar.push({
          universiteName: uniDetay.name,
          universityType: uniDetay.type,
          bolum: bolum.text,
          imamHatip2023: yilVerileri['2023'],
          imamHatip2024: yilVerileri['2024'],
          imamHatip2025: yilVerileri['2025'],
          url: uni.url
        });

        basariliUni++;

        // Her 10 üniversitede bir ilerleme göster
        if ((i + 1) % 10 === 0) {
          console.log(`   → ${i + 1}/${universiteler.length} üniversite işlendi`);
        }

      } catch (error) {
        // Üniversite hatası - kaydet ve devam et
        sonuclar.push({
          universiteName: uni.ad,
          universityType: 'Hata',
          bolum: bolum.text,
          imamHatip2023: { sayi: 'Hata', oran: 'Hata' },
          imamHatip2024: { sayi: 'Hata', oran: 'Hata' },
          imamHatip2025: { sayi: 'Hata', oran: 'Hata' },
          url: uni.url
        });
        hataliUni++;
      }
    }

    logYaz(`[BÖLÜM ${bolumIndex + 1}] TAMAMLANDI - Başarılı: ${basariliUni}, Hatalı: ${hataliUni}`);

  } catch (error) {
    logYaz(`[BÖLÜM ${bolumIndex + 1}] HATA: ${error.message}`);
  } finally {
    await page.close();
  }

  return sonuclar;
}

async function tumBolumlerVeYillarIcinVeriCek() {
  logYaz('='.repeat(80));
  logYaz('YÖK ATLAS VERİ ÇEKME BAŞLATILDI');
  logYaz('='.repeat(80));
  
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer'
    ],
    ignoreHTTPSErrors: true,
    protocolTimeout: 180000 // 3 dakika
  });

  let tumSonuclar = [];
  let islenenBolumler = [];
  let baslangicZamani = Date.now();

  try {
    // ÖNCEKİ CHECKPOINT VAR MI?
    const oncekiVeri = checkpointYukle();
    
    if (oncekiVeri) {
      logYaz('\n🔄 ÖNCEKİ CHECKPOINT BULUNDU!');
      logYaz(`🔄 ${oncekiVeri.checkpoint.islenenBolumler.length} bölüm işlenmiş`);
      logYaz(`🔄 ${oncekiVeri.checkpoint.toplamKayit} kayıt mevcut`);
      logYaz(`🔄 Son güncelleme: ${oncekiVeri.checkpoint.sonGuncelleme}\n`);
      
      tumSonuclar = oncekiVeri.tumSonuclar;
      islenenBolumler = oncekiVeri.checkpoint.islenenBolumler;
    } else {
      logYaz('\n✨ YENİ BAŞLANGIÇ - Checkpoint bulunamadı\n');
    }

    // Bölümleri al
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);
    await page.setBypassCSP(true);

    await page.goto('https://yokatlas.yok.gov.tr/lisans-anasayfa.php', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await bekle(2500);
    await page.click('#flip2 > div > div.face.front.flipControl > div', { timeout: 45000 });
    await bekle(2500);

    const tumBolumler = await page.evaluate(() => {
      const selectElement = document.querySelector('#bolum');
      if (!selectElement) return [];
      
      const options = selectElement.querySelectorAll('option');
      const bolumler = [];
      
      options.forEach(option => {
        const value = option.value;
        const text = option.textContent.trim();
        
        if (value && text && text !== 'Seç...') {
          bolumler.push({ value: value, text: text });
        }
      });
      
      return bolumler;
    });

    await page.close();

    // İşlenmemiş bölümleri filtrele
    const islenecekBolumler = tumBolumler.filter(b => !islenenBolumler.includes(b.value));

    logYaz(`\nTOPLAM BÖLÜM: ${tumBolumler.length}`);
    logYaz(`ÖNCEDEN İŞLENEN: ${islenenBolumler.length}`);
    logYaz(`İŞLENECEK BÖLÜM: ${islenecekBolumler.length}`);
    logYaz(`MOD: 1 PARALEL (STABİL)\n`);

    if (islenecekBolumler.length === 0) {
      logYaz('✅ TÜM BÖLÜMLER ZATEN İŞLENMİŞ!');
      return tumSonuclar;
    }

    // Her bölümü sırayla işle (TEK PARALEL)
    for (let i = 0; i < islenecekBolumler.length; i++) {
      const bolum = islenecekBolumler[i];
      const gercekIndex = islenenBolumler.length + i;
      
      // İlerleme bilgisi
      const yuzde = ((gercekIndex / tumBolumler.length) * 100).toFixed(1);
      const gecenSure = Math.floor((Date.now() - baslangicZamani) / 1000 / 60);
      const tahminiKalanDakika = islenecekBolumler.length > i ? 
        Math.floor(gecenSure / (i + 1) * (islenecekBolumler.length - i)) : 0;
      
      logYaz(`\n${'─'.repeat(80)}`);
      logYaz(`İLERLEME: ${gercekIndex}/${tumBolumler.length} (${yuzde}%)`);
      logYaz(`GEÇEN SÜRE: ${gecenSure} dk | TAHMİNİ KALAN: ${tahminiKalanDakika} dk`);
      logYaz('─'.repeat(80));
      
      // Bölümü işle
      const bolumSonuclari = await birBolumIcinVeriCek(
        browser, 
        bolum, 
        gercekIndex, 
        tumBolumler.length
      );
      
      // Sonuçları ekle
      tumSonuclar = tumSonuclar.concat(bolumSonuclari);
      islenenBolumler.push(bolum.value);
      
      // CHECKPOINT KAYDET (Her bölümden sonra!)
      checkpointKaydet(islenenBolumler, tumSonuclar);
      logYaz(`💾 CHECKPOINT kaydedildi (${tumSonuclar.length} toplam kayıt)`);
      
      // Bölümler arası kısa dinlenme
      await bekle(3000);
    }

    // TÜM İŞ BİTTİ
    checkpointTemizle();
    logYaz('\n✅ TÜM BÖLÜMLER TAMAMLANDI - Checkpoint temizlendi');

    // CSV Kaydet
    const csv = [
      'Üniversite Adı,Üniversite Türü,Bölüm,İH 2023 Sayı,İH 2023 Oran,İH 2024 Sayı,İH 2024 Oran,İH 2025 Sayı,İH 2025 Oran,URL',
      ...tumSonuclar.map(s => 
        `"${s.universiteName}","${s.universityType}","${s.bolum}","${s.imamHatip2023.sayi}","${s.imamHatip2023.oran}","${s.imamHatip2024.sayi}","${s.imamHatip2024.oran}","${s.imamHatip2025.sayi}","${s.imamHatip2025.oran}","${s.url}"`
      )
    ].join('\n');
    
    fs.writeFileSync('tum_veri_3_yil.csv', csv, 'utf-8');
    logYaz('✓ CSV kaydedildi: tum_veri_3_yil.csv');

    fs.writeFileSync('tum_veri_3_yil.json', JSON.stringify(tumSonuclar, null, 2), 'utf-8');
    logYaz('✓ JSON kaydedildi: tum_veri_3_yil.json');

    // ÖZET
    const toplamSure = Math.floor((Date.now() - baslangicZamani) / 1000 / 60);
    const basarili2025 = tumSonuclar.filter(s => s.imamHatip2025.oran.includes('%')).length;
    
    logYaz('\n' + '='.repeat(80));
    logYaz('GENEL ÖZET');
    logYaz('='.repeat(80));
    logYaz(`Toplam Kayıt: ${tumSonuclar.length}`);
    logYaz(`2025 Veri Çekilen: ${basarili2025}`);
    logYaz(`Toplam Süre: ${toplamSure} dakika`);
    logYaz('='.repeat(80));

  } catch (error) {
    logYaz(`\n❌ GENEL HATA: ${error.message}`);
    logYaz('⚠️  Checkpoint kaydedildi, tekrar çalıştırarak devam edebilirsiniz!');
  } finally {
    await browser.close();
    logYaz('\nTarayıcı kapatıldı');
  }

  return tumSonuclar;
}

// Çalıştır
tumBolumlerVeYillarIcinVeriCek();
