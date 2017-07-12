const path = require('path');

const gulp = require('gulp');
const del = require('del');
const filter = require('gulp-filter');

const conf = require('../conf/gulp.conf');
// const webpackconf = require('../conf/webpack.conf');

gulp.task('clean', clean);
gulp.task('other', other);
// gulp.task('setlocal', setlocal);
// gulp.task('setonline', setonline);

function clean() {
  return del([conf.paths.dist, conf.paths.tmp]);
}

function other() {
  const fileFilter = filter(file => file.stat.isFile());

  return gulp.src([
    path.join(conf.paths.srcdist, '/**/*'),
    path.join(`!${conf.paths.srcdist}`, '/**/*.{html,ts,css,js,scss}')
  ])
    .pipe(fileFilter)
    .pipe(gulp.dest(conf.paths.dist));
}
//
// function setlocal(done) {
//   conf.paths.src = conf.paths.srclocal;
//   done();
// }
//
// function setonline(done) {
//   conf.paths.src = conf.paths.srconline;
//   done();
// }
