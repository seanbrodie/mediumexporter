const utils = require("./utils");
const path = require("path");
const fs = require("fs");
const r2 = require("r2");
const slugify = require("underscore.string/slugify");
let options = {};

function createFolder(path) {
  try {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
  } catch (err) {
    // may exist already, ignore
    console.error(err);
  }
  return;
}

module.exports = async function(mediumURL, params = {}) {
  options = params;

  if (mediumURL == null) {
    console.error("url undefined");
    process.exit(1);
  }

  let output = null;
  const json = await utils.loadMediumPost(mediumURL, options);
  const s = json.payload.post || json.payload.value;
  const story = {};
  const images = [];

  story.title = s.title.replace(/:/g, "&#58;");
  story.subtitle = s.virtuals.subtitle.trim().replace(/:/g, "&#58;");
  story.author = s.displayAuthor;
  story.date = new Date(s.createdAt).toJSON();
  // story.slug = s.slug
  story.slug = s.id;
  story.url = s.canonicalUrl;
  story.images = [];
  story.language = s.detectedLanguage;

  if (s.virtuals.tags) {
    story.tags = s.virtuals.tags.map(t => t.slug);
  }
  if (s.license && s.license !== 0) {
    story.license = s.license;
  }

  if (s.virtuals.previewImage) {
    story.featuredImage = s.virtuals.previewImage.imageId;
  }

  if (params && params.info) {
    process.exit(0);
  }

  if (params) {
    output = params.output ? params.output : "content";
  } else {
    output = process.env.PWD;
  }

  story.sections = s.content.bodyModel.sections;
  story.paragraphs = s.content.bodyModel.paragraphs;

  const sections = [];
  for (let i = 0; i < story.sections.length; i++) {
    const s = story.sections[i];
    const section = utils.processSection(s, story.slug, images, options);
    sections[s.startIndex] = section;
  }

  if (story.paragraphs.length > 1) {
    story.subtitle = story.paragraphs[1].text;
  }

  story.markdown = [];
  if (!options.frontmatter) {
    story.markdown.push("\n# " + story.title.replace(/\n/g, "\n# "));
    if (undefined != story.subtitle) {
      story.markdown.push("\n## " + story.subtitle.replace(/#+/, ""));
    }
  }

  let lastParagraph = null;
  story.paragraphs = story.paragraphs.filter((p, idx) => {
    if (p.type === 8 && lastParagraph && lastParagraph.type === 8) {
      lastParagraph.text += "\n\n" + p.text;
      return false;
    }
    lastParagraph = p;
    return true;
  });

  const promises = [];
  for (let i = 2; i < story.paragraphs.length; i++) {
    if (sections[i]) story.markdown.push(sections[i]);

    const promise = new Promise(function(resolve, reject) {
      const p = story.paragraphs[i];

      const text = utils.processParagraph(p, story.slug, images, options);
      return resolve(text);
    });
    promises.push(promise);
  }

  return Promise.all(promises)
    .then(async results => {
      let featuredImage = story.featuredImage;
      let outputPath = path.join(output, story.slug);
      let outputImagesPath = path.join(output, story.slug, "images");
      if (!!options.jekyll) {
        outputPath = path.join(output, `assets/images/${story.slug}`);
      }
      createFolder(outputPath);
      createFolder(outputImagesPath);
      story.images = await utils.downloadImages(images, {
        featuredImage: featuredImage,
        imageFolder: outputImagesPath
      });

      for (let text of results) {
        story.markdown.push(text);
      }

      if (params && params.debug) {
        console.log("debug", story.paragraphs);
      }

      // frontmatter
      let outputText = "";
      if (options.frontmatter) {
        outputText = "---\n";
        outputText += `slug: ${story.slug}\n`;
        outputText += `date: ${story.date}\n`;
        outputText += `author: "${story.author}"\n`;
        outputText += `title: "${story.title}"\n`;
        if (story.subtitle) {
          outputText += `subtitle: "${story.subtitle}"\n`;
        }
        if (story.images.length > 0) {
          outputText += "images:\n";
          for (const image of story.images) {
            outputText += `  - ${image}\n`;
          }
        }
        if (story.tags.length > 0) {
          outputText += "tags:\n";
          for (const tag of story.tags) {
            outputText += `  - ${tag}\n`;
          }
          outputText += "keywords:\n";
          for (const tag of story.tags) {
            outputText += `  - ${tag}\n`;
          }
        }
        outputText += "draft: true" + "\n";
        outputText += "---\n";
      }

      outputText += story.markdown.join("\n");

      // replace images with b64
      for (img of story.images) {
        let prefix = "data:image/png;base64,";
        outputText = outputText.replace(
          "./images/" + img.filename,
          prefix + img.base64
        );
      }

      outputPath = `${output}/${story.slug}.md`;

      if (!!options.jekyll) {
        outputPath = `${output}/${story.date.slice(0, 10)}-${story.slug}.md`;
      }
      if (output) {
        outputPath = path.join(output, story.slug) + "/index.md";
        fs.writeFileSync(outputPath, outputText);
        return {
          title: story.title,
          id: story.slug,
          url: story.url,
          images: story.images,
          content: outputText
        };
      } else if (!output && params && params.commands) {
        console.log(outputText);
        return outputText;
      } else {
        return outputText;
      }
    })
    .catch(err => {
      console.log("something went wrong");
      console.log(err);
      return err;
    });
};
