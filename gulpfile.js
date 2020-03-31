const AWS = require('aws-sdk'),
	awspublish = require('gulp-awspublish'),
	browserify = require('browserify'),
	buffer = require('vinyl-buffer'),
	bump = require('gulp-bump'),
	compareVersions = require('compare-versions'),
	docsify = require('docsify-cli/lib/commands/init'),
	file = require('gulp-file'),
	fs = require('fs'),
	git = require('gulp-git'),
	gitStatus = require('git-get-status'),
	glob = require('glob'),
	gulp = require('gulp'),
	jasmine = require('gulp-jasmine'),
	jsdoc2md = require('jsdoc-to-markdown'),
	jshint = require('gulp-jshint'),
	merge = require('merge-stream'),
	path = require('path'),
	prompt = require('gulp-prompt'),
	rename = require('gulp-rename'),
	replace = require('gulp-replace'),
	source = require('vinyl-source-stream'),
	spawn = require('child_process').spawn;

const docsifyTemplates = require('./docsifyTemplates');

function getVersionFromPackage() {
	return JSON.parse(fs.readFileSync('./package.json', 'utf8')).version;
}

function getVersionForComponent() {
	return getVersionFromPackage().split('.').slice(0, 2).join('.');
}

function preparePathForDocs(path) {
	return `/content/sdk/${path}`.toLocaleLowerCase();
}

function prepareLinkForDocs(path, tab) {
	const name = path.replace(/-/g, '/');
	return `${tab ? '\t' : ''}* [${name}](${preparePathForDocs(path)})\n`;
}

function generateReleaseNotes() {
	const contentDir = `${__dirname}/docs/content`;
	const releasesDir = `${contentDir}/releases`;
	let releasesTemplate = docsifyTemplates.releasesTemplate;
	let releaseNotes = [];

	try	{
		const releaseFiles = fs.readdirSync(releasesDir);
		releaseNotes = releaseFiles
			.filter((file) => file !== '_sidebar.md')
			.map((file) => file.replace('.md', ''))
			.sort(compareVersions)
			.reverse();
	} catch (e) {
		console.log(`Unable to scan directory [ ${releasesDir} ]: ${e}`);
	}

	releaseNotes.forEach((file) => {
		const release = fs.readFileSync(`${releasesDir}/${file}.md`).toString();
		if (release){
			releasesTemplate += `\n## ${file}\n${release}\n`;
		}
	});

	releasesTemplate += '\n<!-- releases_close -->';

	gulp.src([`${contentDir}/release_notes.md`])
		.pipe(replace(/(<!-- releases_open -->(\s|.)*<!-- releases_close -->)/gm, releasesTemplate))
		.pipe(gulp.dest(contentDir));
}

function generateDocs(inputFiles = 'lib/**/*.js') {
	global.packageName = '@barchart/marketdata-api-js';

	const docDir = `${__dirname}/docs`;
	const contentDir = `${docDir}/content`;
	const conceptsDir = `${contentDir}/concepts`;
	const releasesDir = `${contentDir}/releases`;
	const sdkDir = `${contentDir}/sdk`;
	const template = `{{>main}}`;

	let sdkReference = docsifyTemplates.sdkReference;
	let sdkSidebar = docsifyTemplates.sdkSidebar;
	
	return jsdoc2md.clear().then(() => {
		return jsdoc2md.getTemplateData({
			files: inputFiles
		}).then((templateData) => {
			return templateData.reduce((templateGroups, identifier) => {
				if (!identifier.meta) {
					return templateGroups;
				}

				const path = identifier.meta.path;
				const arrayFilePath = path.split('lib/');
				const filePath = 'lib-' + arrayFilePath[1].replace(/\//g, '-');

				if (!templateGroups.dataByPath[filePath]) {
					templateGroups.dataByPath[filePath] = [];
				}

				templateGroups.dataByPath[filePath].push(identifier);
				if (!identifier.ignore) {
					templateGroups.pathById[identifier.id] = preparePathForDocs(filePath).toLocaleLowerCase();
				}

				return templateGroups;
			}, {dataByPath: {}, pathById: {}});
		}).then((templateGroups) => {
			global.pathById = templateGroups.pathById;

			const keys = Object.keys(templateGroups.dataByPath).sort();
			keys.forEach((filePath) => {
				const data = templateGroups.dataByPath[filePath];

				const output = jsdoc2md.renderSync({
					data: data,
					template,
					separators: true,
					plugin: '@barchart/dmd-plugin',
					"global-index-format": 'md'
				});

				if (output) {
					sdkReference += prepareLinkForDocs(filePath);
					sdkSidebar += prepareLinkForDocs(filePath, true);
					fs.writeFileSync(path.resolve(sdkDir, `${filePath.toLowerCase()}.md`), output);
				}
			});

			sdkSidebar += '<!-- sdk_close -->';

			fs.writeFileSync(path.resolve(contentDir, `sdk_reference.md`), sdkReference);

			gulp.src([`${docDir}/_sidebar.md`], {allowEmpty: true})
				.pipe(replace(/(<!-- sdk_open -->(\s|.)*<!-- sdk_close -->)/gm, sdkSidebar))
				.pipe(gulp.dest(sdkDir));

			gulp.src([`${docDir}/_sidebar.md`])
				.pipe(gulp.dest(contentDir))
				.pipe(gulp.dest(conceptsDir))
				.pipe(gulp.dest(releasesDir));

			generateReleaseNotes();
		});
	});
}

gulp.task('docsify', () => {
	const isInited = fs.existsSync("./docs/index.html");

	const generateStructure = new Promise((resolve, reject) => {
		if (!isInited) {
			const sidebar = docsifyTemplates.sidebar;
			const docsifyConfig = docsifyTemplates.docsifyConfig;
			const styles = docsifyTemplates.styles;
			const indexHTMLHead = docsifyTemplates.indexHTMLHead;
			const quickStart = docsifyTemplates.quickStart;
			const productOverview = docsifyTemplates.productOverview;
			const releaseNotes = docsifyTemplates.releaseNotes;
			const coverPageTemplate = docsifyTemplates.coverPage(getVersionFromPackage());

			fs.mkdirSync(`${__dirname}/docs/content/sdk`, {recursive: true});
			fs.mkdirSync(`${__dirname}/docs/content/releases`, {recursive: true});

			docsify("./docs", "", "vue");

			merge(
				gulp.src(['./docs/index.html'])
					.pipe(replace(/(window.\$docsify.*)/g, docsifyConfig))
					.pipe(replace(/(<\/head>)/g, indexHTMLHead))
					.pipe(gulp.dest('./docs/')),

				gulp.src(['./docs/styles/override.css'], {allowEmpty: true})
					.pipe(file('override.css', styles))
					.pipe(gulp.dest('./docs/styles')),

				gulp.src(['docs/content/quick_start.md'], {allowEmpty: true})
					.pipe(file('quick_start.md', quickStart))
					.pipe(gulp.dest('./docs/content')),

				gulp.src(['docs/content/product_overview.md'], {allowEmpty: true})
					.pipe(file('product_overview.md', productOverview))
					.pipe(gulp.dest('./docs/content')),

				gulp.src(['docs/content/release_notes.md'], {allowEmpty: true})
					.pipe(file('release_notes.md', releaseNotes))
					.pipe(gulp.dest('./docs/content')),

				gulp.src(['docs/_sidebar.md'], {allowEmpty: true})
					.pipe(file('_sidebar.md', sidebar))
					.pipe(gulp.dest('./docs/')),

				gulp.src(['docs/_coverpage.md'], {allowEmpty: true})
					.pipe(file('_coverpage.md', coverPageTemplate))
					.pipe(gulp.dest('./docs/'))
					.on("end", resolve)
					.on("error", reject)
			);
		} else {
			return resolve();
		}
	});

	return generateStructure.then(() => {
		return generateDocs();
	});
});

gulp.task('ensure-clean-working-directory', (cb) => {
	gitStatus((err, status) => {
		if (err, !status.clean) {
			throw new Error('Unable to proceed, your working directory is not clean.');
		}

		cb();
	});
});

gulp.task('bump-choice', (cb) => {
	const processor = prompt.prompt({
		type: 'list',
		name: 'bump',
		message: 'What type of bump would you like to do?',
		choices: ['patch', 'minor', 'major'],
	}, (res) => {
		global.bump = res.bump;

		return cb();
	});

	return gulp.src(['./package.json']).pipe(processor);
});

gulp.task('bump-version', () => {
	return gulp.src(['./package.json'])
		.pipe(bump({type: global.bump}))
		.pipe(gulp.dest('./'));
});

gulp.task('embed-version', () => {
	const version = getVersionFromPackage();

	return gulp.src(['./lib/meta.js'])
		.pipe(replace(/(version:\s*')([0-9]+\.[0-9]+\.[0-9]+)(')/g, '$1' + version + '$3'))
		.pipe(gulp.dest('./lib/'));
});

gulp.task('commit-changes', () => {
	return gulp.src(['./', './test/', './package.json', './lib/meta.js'])
		.pipe(git.add())
		.pipe(git.commit('Release. Bump version number'));
});

gulp.task('push-changes', (cb) => {
	git.push('origin', 'master', cb);
});

gulp.task('create-tag', (cb) => {
	const version = getVersionFromPackage();

	git.tag(version, 'Release ' + version, (error) => {
		if (error) {
			return cb(error);
		}

		git.push('origin', 'master', {args: '--tags'}, cb);
	});
});

gulp.task('build-example-bundle', () => {
	return browserify(['./example/browser/js/startup.js'])
		.bundle()
		.pipe(source('example.js'))
		.pipe(buffer())
		.pipe(gulp.dest('./example/browser/'));
});

gulp.task('build', gulp.series('build-example-bundle'));

gulp.task('upload-example-to-S3', () => {
	let publisher = awspublish.create({
		region: 'us-east-1',
		params: {
			Bucket: 'barchart-examples'
		},
		credentials: new AWS.SharedIniFileCredentials({profile: 'default'})
	});

	let headers = {'Cache-Control': 'no-cache'};
	let options = {};

	return gulp.src(['./example/browser/example.css', './example/browser/example.html', './example/browser/example.js'])
		.pipe(rename((path) => {
			path.dirname = 'marketdata-api-js';
		}))
		.pipe(publisher.publish(headers, options))
		.pipe(publisher.cache())
		.pipe(awspublish.reporter());
});

gulp.task('deploy-example', gulp.series('upload-example-to-S3'));

gulp.task('build-browser-tests', () => {
	return browserify({entries: glob.sync('test/specs/**/*.js')}).bundle()
		.pipe(source('barchart-marketdata-api-tests-' + getVersionForComponent() + '.js'))
		.pipe(buffer())
		.pipe(gulp.dest('test/dist'));
});

gulp.task('execute-browser-tests', () => {
	return gulp.src('test/dist/barchart-marketdata-api-tests-' + getVersionForComponent() + '.js')
		.pipe(jasmine());
});

gulp.task('execute-node-tests', () => {
	return gulp.src(['test/specs/**/*.js'])
		.pipe(jasmine());
});

gulp.task('test', gulp.series(
	'build-browser-tests',
	'execute-browser-tests',
	'execute-node-tests'
));

gulp.task('create-release', (cb) => {
	const version = getVersionFromPackage();

	const processor = prompt.prompt({
		type: 'input',
		name: 'path',
		message: 'Please enter release notes path (relative to gulpfile.js):'
	}, (res) => {
		const path = res.path;

		if (!fs.existsSync(path)) {
			return cb(new Error(`Release markdown file not found: ${path}`));
		}

		const child = spawn(`hub release create -f ${path} ${version}`, {
			stdio: 'inherit',
			shell: true,
		});

		child.on('error', (error) => {
			console.log(error);

			cb(error);
		});

		child.on('exit', () => {
			cb();
		});
	});

	return gulp.src('./package.json').pipe(processor);
});

gulp.task('bump-and-tag', gulp.series(
	'ensure-clean-working-directory',
	'bump-choice',
	'bump-version',
	'commit-changes',
	'push-changes',
	'create-tag'
));

gulp.task('release', gulp.series(
	'ensure-clean-working-directory',
	'create-release'
));

gulp.task('watch', () => {
	gulp.watch('./lib/**/*.js', gulp.series('build-example-bundle'));
});

gulp.task('lint', () => {
	return gulp.src(['./lib/**/*.js', './test/specs/**/*.js'])
		.pipe(jshint({'esversion': 6}))
		.pipe(jshint.reporter('default'));
});

gulp.task('default', gulp.series('lint'));
