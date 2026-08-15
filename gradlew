#!/usr/bin/env sh

APP_HOME=$(cd "${0%/*}" >/dev/null 2>&1 && pwd -P)

if [ -f "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" ]; then
  exec java -classpath "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain "$@"
fi

if command -v gradle >/dev/null 2>&1; then
  exec gradle "$@"
fi

echo "Gradle Wrapper JAR absent. Installe Gradle ou lance 'gradle wrapper --gradle-version 8.7' une fois." >&2
exit 1
