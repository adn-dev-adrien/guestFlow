<?php
/**
 * Genere le jumeau .webp de chaque JPEG et PNG de la mediatheque.
 *
 * Le service est assure par Apache (wp-content/uploads/.htaccess) : « photo.jpg » est
 * remplace par « photo.webp » quand le navigateur l'accepte et que le fichier existe.
 * Le script est idempotent : un jumeau a jour est laisse tel quel.
 */

$racine  = '/var/www/html/wp-content/uploads';
$qualite = 82;

$iterateur = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $racine, FilesystemIterator::SKIP_DOTS ) );

$crees  = 0;
$sautes = 0;
$echecs = 0;

foreach ( $iterateur as $fichier ) {
	if ( ! $fichier->isFile() ) {
		continue;
	}
	$ext = strtolower( $fichier->getExtension() );
	if ( ! in_array( $ext, array( 'jpg', 'jpeg', 'png' ), true ) ) {
		continue;
	}

	$source = $fichier->getPathname();
	$cible  = preg_replace( '~\.(jpe?g|png)$~i', '.webp', $source );

	if ( file_exists( $cible ) && filemtime( $cible ) >= filemtime( $source ) ) {
		$sautes++;
		continue;
	}

	$image = ( 'png' === $ext ) ? @imagecreatefrompng( $source ) : @imagecreatefromjpeg( $source );
	if ( ! $image ) {
		$echecs++;
		fwrite( STDERR, "illisible : $source\n" );
		continue;
	}
	if ( 'png' === $ext ) {
		imagepalettetotruecolor( $image );
		imagealphablending( $image, true );
		imagesavealpha( $image, true );
	}

	if ( imagewebp( $image, $cible, $qualite ) ) {
		chmod( $cible, 0644 );
		$crees++;
	} else {
		$echecs++;
		fwrite( STDERR, "echec ecriture : $cible\n" );
	}
	imagedestroy( $image );
}

printf( "jumeaux crees : %d\ndeja a jour   : %d\nechecs        : %d\n", $crees, $sautes, $echecs );
