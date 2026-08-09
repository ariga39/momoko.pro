// Unit tests explicitly inject the synthetic package. Production/dev builds
// never inherit this setting; they use the versioned package under content/.
process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/synthetic";
