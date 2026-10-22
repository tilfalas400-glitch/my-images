/* engine.js - محرك توليد الصور (AI Horde) منفصل عن الواجهة */
const Engine = (() => {
  const API = "https://aihorde.net/api/v2";
  const STYLES = {
    none:  { p: "", n: "blurry, low quality, deformed, text, watermark" },
    real:  { p: "photorealistic, 35mm photo, natural light, sharp focus", n: "cartoon, painting, blurry, deformed hands, extra fingers, watermark" },
    art:   { p: "digital painting, concept art, detailed, artstation", n: "photo, blurry, low quality, text" },
    anime: { p: "anime style, clean line art, vibrant colors", n: "photo, blurry, bad anatomy, text" },
    char:  { p: "character design, full body, simple background", n: "cropped, blurry, bad anatomy, extra limbs" },
    bg:    { p: "wide landscape background, matte painting, atmospheric", n: "people, text, blurry, watermark" }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 1) قائمة النماذج الأكثر توفرًا
  async function models(limit = 15) {
    const m = await (await fetch(API + "/status/models?type=image")).json();
    return m.sort((a, b) => b.count - a.count).slice(0, limit).map(x => x.name);
  }

  // 2) ترجمة عربي -> إنجليزي (MyMemory: مجاني بحصة يومية محدودة)
  async function translate(t) {
    if (!/[\u0600-\u06FF]/.test(t)) return t;
    try {
      const r = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(t) + "&langpair=ar|en");
      return (await r.json()).responseData.translatedText || t;
    } catch (e) { return t; }
  }

  // 3) سجل الأوصاف (نص فقط)
  const hist = {
    get() { try { return JSON.parse(localStorage.getItem("hist") || "[]"); } catch (e) { return []; } },
    add(o) { try { const h = [o, ...this.get().filter(x => x.prompt !== o.prompt)].slice(0, 20); localStorage.setItem("hist", JSON.stringify(h)); } catch (e) {} }
  };

  // 4) التوليد
  // o: {prompt, style, width, height, model, steps, cfg, n, upscale, faces, source, strength, key}
  async function generate(o, onStatus = () => {}) {
    const s = STYLES[o.style] || STYLES.none;
    const prompt = [o.prompt, s.p].filter(Boolean).join(", ") + " ### " + s.n;
    const body = {
      prompt, nsfw: false, r2: true,
      params: {
        width: o.width || 512, height: o.height || 512,
        steps: o.steps || 30, cfg_scale: o.cfg || 7,
        sampler_name: "k_dpmpp_2m", karras: true, n: o.n || 1,
        post_processing: [o.faces ? "GFPGAN" : null, o.upscale ? "RealESRGAN_x4plus" : null].filter(Boolean)
      }
    };
    if (o.model) body.models = [o.model];
    if (o.source) {
      body.source_image = o.source;
      body.source_processing = "img2img";
      body.params.denoising_strength = o.strength || 0.6;
    }
    const H = { "Content-Type": "application/json", apikey: o.key || "0000000000", "Client-Agent": "arabic-image-maker:2:personal" };
    onStatus("جارٍ إرسال الطلب...");
    const j = await (await fetch(API + "/generate/async", { method: "POST", headers: H, body: JSON.stringify(body) })).json();
    if (!j.id) throw new Error(j.message || "رفض الخادم الطلب");
    for (let i = 0; i < 150; i++) {
      await sleep(4000);
      const c = await (await fetch(API + "/generate/check/" + j.id)).json();
      if (c.faulted) throw new Error("فشل التوليد، أعد المحاولة");
      if (c.done) break;
      onStatus("الطابور: " + (c.queue_position ?? "؟") + " | المتبقي تقريبًا " + (c.wait_time ?? "؟") + " ثانية");
    }
    const r = await (await fetch(API + "/generate/status/" + j.id)).json();
    if (!r.generations || !r.generations.length) throw new Error("انتهت المهلة، جرّب مرة أخرى");
    hist.add({ prompt: o.prompt, style: o.style });
    return r.generations.map(g => g.img.startsWith("http") ? g.img : "data:image/webp;base64," + g.img);
  }

  // قراءة ملف صورة كـ base64 للتعديل
  const fileToB64 = f => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.split(",")[1]);
    r.onerror = no;
    r.readAsDataURL(f);
  });

  return { models, translate, generate, hist, fileToB64, STYLES };
})();
