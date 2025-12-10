const puppeteer = require('puppeteer');
const fs = require('fs');

const bekle = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const BOLUMLER = [
  'HEMŞİRELİK',
  'ENDÜSTRİ MÜHENDİSLİĞİ',
  'SAĞLIK YÖNETİMİ',
  'İLETİŞİM',
  'DİŞ HEKİMLİĞİ',
  'ÇOCUK GELİŞİMİ',
  'DİN KÜLTÜRÜ VE AHLAK BİLGİSİ ÖĞRETMENLİĞİ',
  'ELEKTRİK-ELEKTRONİK MÜHENDİSLİĞİ',
  'ULUSLARARASI İLİŞKİLER',
  'OKUL ÖNCESİ ÖĞRETMENLİĞİ',
  'MİMARLIK',
  'SINIF ÖĞRETMENLİĞİ',
  'TÜRKÇE ÖĞRETMENLİĞİ',
  'MAKİNE MÜHENDİSLİĞİ',
  'İKTİSAT',
  'TARİH ÖĞRETMENLİĞİ',
  'ECZACILIK',
  'SİYASET BİLİMİ VE KAMU YÖNETİMİ',
  'TÜRK DİLİ VE EDEBİYATI ÖĞRETMENLİĞİ',
  'VETERİNERLİK',
  'GAZETECİLİK'
];

async function tumBolumlerIcinVeriCek() {
  console.log('Tarayıcı başlatılıyor...');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list'
    ],
    ignoreHTTPSErrors: true,
    slowMo: 30
  });

  const page = await browser.newPage();
  await page.setBypassCSP(true);

  const tumSonuclar = [];

  try {
    for (let bolumIndex = 0; bolumIndex < BOLUMLER.length; bolumIndex++) {
      const bolumAdi = BOLUMLER[bolumIndex];
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`BÖLÜM [${bolumIndex + 1}/${BOLUMLER.length}]: ${bolumAdi}`);
      console.log('='.repeat(80));

      try {
        // Ana sayfaya git
        await page.goto('https://yokatlas.yok.gov.tr/lisans-anasayfa.php', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        await bekle(2000);

        // Bölüm seç butonuna tıkla
        await page.click('#flip2 > div > div.face.front.flipControl > div');
        await bekle(2000);

        // Bölümü bul ve tıkla
        const bolumBulundu = await page.evaluate((arananBolum) => {
          const items = document.querySelectorAll('.dropdown-menu.inner li');
          for (let item of items) {
            const text = item.textContent.trim();
            if (text === arananBolum) {
              item.querySelector('a').click();
              return true;
            }
          }
          return false;
        }, bolumAdi);

        if (!bolumBulundu) {
          console.log(`  ✗ ${bolumAdi} bölümü bulunamadı!`);
          continue;
        }

        await bekle(3000);

        // Tüm üniversiteleri al
        const universiteler = await page.evaluate(() => {
          const universities = [];
          
          // Sol kolon
          const solListe = document.querySelector('#bs-collapse');
          if (solListe) {
            const solLinkler = solListe.querySelectorAll('a[href*="lisans.php"]');
            solLinkler.forEach(link => {
              universities.push({
                ad: link.textContent.trim(),
                url: link.href
              });
            });
          }
          
          // Sağ kolon
          const sagListe = document.querySelector('#bs-collapse2');
          if (sagListe) {
            const sagLinkler = sagListe.querySelectorAll('a[href*="lisans.php"]');
            sagLinkler.forEach(link => {
              universities.push({
                ad: link.textContent.trim(),
                url: link.href
              });
            });
          }
          
          return universities;
        });

        console.log(`Toplam ${universiteler.length} üniversite bulundu.\n`);

        for (let i = 0; i < universiteler.length; i++) {
          const uni = universiteler[i];
          console.log(`  [${i + 1}/${universiteler.length}] ${uni.ad.substring(0, 50)}...`);

          try {
            await page.goto(uni.url, {
              waitUntil: 'networkidle2',
              timeout: 30000
            });

            await bekle(1500);

            const baslikTiklandi = await page.evaluate(() => {
              const panelBasliklari = document.querySelectorAll('.panel-heading');
              for (let baslik of panelBasliklari) {
                const text = baslik.textContent;
                if (text.includes('Yerleşenlerin Mezun Oldukları Lise Grubu')) {
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
              await bekle(4000);

              // İmam Hatip oranını çek
              const veri = await page.evaluate(() => {
                const tumTablelar = document.querySelectorAll('table.table-bordered');
                
                for (let tablo of tumTablelar) {
                  const satirlar = tablo.querySelectorAll('tbody tr');
                  
                  for (let satir of satirlar) {
                    const hücreler = satir.querySelectorAll('td');
                    
                    if (hücreler.length >= 3) {
                      const liseAdi = hücreler[0].textContent.trim();
                      const sayi = hücreler[1].textContent.trim();
                      const yuzde = hücreler[2].textContent.trim();
                      
                      if (liseAdi.includes('Anadolu İmam Hatip')) {
                        return {
                          bulundu: true,
                          sayi: sayi,
                          yuzde: yuzde
                        };
                      }
                    }
                  }
                }
                
                return { bulundu: false };
              });

              if (veri.bulundu) {
                console.log(`    ✓ ${veri.yuzde}`);
                tumSonuclar.push({
                  universite: uni.ad,
                  bolum: bolumAdi,
                  imamHatipSayisi: veri.sayi,
                  imamHatipOrani: veri.yuzde,
                  url: uni.url
                });
              } else {
                tumSonuclar.push({
                  universite: uni.ad,
                  bolum: bolumAdi,
                  imamHatipSayisi: 'Bulunamadı',
                  imamHatipOrani: 'Bulunamadı',
                  url: uni.url
                });
              }
            } else {
              tumSonuclar.push({
                universite: uni.ad,
                bolum: bolumAdi,
                imamHatipSayisi: 'Veri Yok',
                imamHatipOrani: 'Veri Yok',
                url: uni.url
              });
            }

          } catch (error) {
            console.error(`    ✗ Hata: ${error.message}`);
            tumSonuclar.push({
              universite: uni.ad,
              bolum: bolumAdi,
              imamHatipSayisi: 'Hata',
              imamHatipOrani: 'Hata',
              url: uni.url
            });
          }

          await bekle(300);
        }

      } catch (error) {
        console.error(`Bölüm hatası (${bolumAdi}):`, error.message);
      }
    }

    // Dosyalara kaydet
    const csv = [
      'Üniversite,Bölüm,İmam Hatip Sayısı,İmam Hatip Oranı,URL',
      ...tumSonuclar.map(s => `"${s.universite}","${s.bolum}","${s.imamHatipSayisi}","${s.imamHatipOrani}","${s.url}"`)
    ].join('\n');
    
    fs.writeFileSync('tum_bolumler_imamhatip_oranlari.csv', csv, 'utf-8');
    console.log('\n\n✓ Veriler tum_bolumler_imamhatip_oranlari.csv dosyasına kaydedildi');

    fs.writeFileSync('tum_bolumler_imamhatip_oranlari.json', JSON.stringify(tumSonuclar, null, 2), 'utf-8');
    console.log('✓ Veriler tum_bolumler_imamhatip_oranlari.json dosyasına kaydedildi\n');

    // Özet
    console.log('\n' + '='.repeat(80));
    console.log('GENEL ÖZET');
    console.log('='.repeat(80));
    console.log(`Toplam Kayıt: ${tumSonuclar.length}`);
    
    const basarili = tumSonuclar.filter(s => s.imamHatipOrani.includes('%')).length;
    console.log(`Veri Çekilen: ${basarili}`);
    console.log(`Veri Çekilemeyen: ${tumSonuclar.length - basarili}`);
    
    // Bölüm bazında özet
    console.log('\nBölüm Bazında:');
    BOLUMLER.forEach(bolum => {
      const bolumKayitlari = tumSonuclar.filter(s => s.bolum === bolum);
      const bolumBasarili = bolumKayitlari.filter(s => s.imamHatipOrani.includes('%')).length;
      console.log(`  ${bolum}: ${bolumBasarili}/${bolumKayitlari.length}`);
    });
    
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('Genel Hata:', error);
  } finally {
    await browser.close();
    console.log('Tarayıcı kapatıldı');
  }

  return tumSonuclar;
}

// Çalıştır
tumBolumlerIcinVeriCek();