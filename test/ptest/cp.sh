#!pigshell

sh -s testlib.sh
echo "cp tests started on" $(date)

SAMPLEDIR="/home/sample"

CHUNKSIZE=262144
COPTS="-o cp.chunksize="^$CHUNKSIZE
#GDRIVEUSER1="changeme@gmail.com"
#GDRIVEUSER2="changemetoo@somecompany.com"
DEATHSTAR=1

# simplercp sourcedir targetdir checkdir num
function simplercp {
    cp -vr $COPTS $1 $2 2>$RESDIR/cp.$4.1
    dcheck $? true cp.$4.1
    cmpdir $1 $3 debug
    expect $? true cp.$4.2
}

# partcp sourcefile targetdir num
function partcp {
    cp -v -o range.off=0,range.len=1024 $1 $2 2>$RESDIR/cp.$3.1
    dcheck $? true cp.$3.1
    cp -vc -o range.off=1024,range.len=1024 $1 $2 2>$RESDIR/cp.$3.2
    dcheck $? true cp.$3.2
    cp -vc $COPTS $1 $2 2>$RESDIR/cp.$3.3
    dcheck $? true cp.$3.3
    cmp $1 $2
    expect $? true cp.$3.4
}

function ramfs_test {
    TMP="/tmp/cptest"
    TMP1="/tmp/cptest/cptest1"
    TMP2="/tmp/cptest/cptest2"

    mkdir $TMP $TMP1 $TMP2 2>/dev/null

    # With trailing slash, should copy contents
    simplercp $SAMPLEDIR/ $TMP1 $TMP1 ramfs.slash
    # Without trailing slash, should copy directory as well
    simplercp $SAMPLEDIR $TMP2 $TMP2/sample ramfs.noslash

    partcp $SAMPLEDIR/clickingofcuthbert.pdf $TMP/clickingofcuthbert.pdf ramfs.partcp
}

function pstyfs_test {
    TMP="/home/cptest"
    TMP1="/home/tmp/cptest/cptest1"
    TMP2="/home/tmp/cptest/cptest2"
    mkdir $TMP $TMP1 $TMP2 2>/dev/null
    rm -r $TMP1/*  2>/dev/null
    rm -r $TMP2/* 2>/dev/null

    simplercp $SAMPLEDIR/ $TMP1 $TMP1 pstyfs.slash
    simplercp $SAMPLEDIR $TMP2 $TMP2/sample pstyfs.noslash

    partcp $SAMPLEDIR/clickingofcuthbert.pdf /home/tmp/clickingofcuthbert.pdf pstyfs.partcp
}

# GDrive as source
function gdrivefs_test {
    GDRIVESRC=/gdrive/$GDRIVEUSER1/pigshell-test
    GDRIVEDST=/gdrive/$GDRIVEUSER2/pigshell-test

    if ! [ -d $GDRIVESRC ]; then echo "GDRIVEUSER1 not available; skipping"; return; fi
    TMP1="/home/tmp/cptest/cptest-gdrive"
    mkdir $TMP1 2>/dev/null
    rm -r $TMP1/* 2>/dev/null

    rm -r $TMP1/sample 2>/dev/null
    cp -vr $COPTS $GDRIVESRC/sample $TMP1 2>$RESDIR/cp.gdrive.1
    dcheck $? true cp.gdrive.1
    cmpdir $SAMPLEDIR $TMP1/sample
    expect $? true cp.gdrive.2

    cp -vrc $COPTS $GDRIVESRC/sample $TMP1 2>$RESDIR/cp.gdrive.3
    dcheck $? true cp.gdrive.3

    mkdir $GDRIVESRC/target 2>/dev/null
    rm -r $GDRIVESRC/target/* 2>/dev/null
    cp -vr $SAMPLEDIR $GDRIVESRC/target 2>$RESDIR/cp.gdrive.4
    dcheck $? true cp.gdrive.4

    # Copy files straight from one user to another
    if ! [ -d $GDRIVEDST ]; then echo "GDRIVEUSER2 not available; skipping"; return; fi
    rm -r $GDRIVEDST/sample 2>/dev/null
    cp -vr $GDRIVESRC/sample $GDRIVEDST 2>$RESDIR/cp.gdrive.5
    dcheck $? true cp.gdrive.5
    cmpdir $SAMPLEDIR $GDRIVEDST/sample
    expect $? true cp.gdrive.6
}

function gdrivefs_doc_test {
    SRCDIR="/home/tmp/sampledocs"
    DSTDIR=/gdrive/$GDRIVEUSER1/pigshell-test
    DSTDIR2=/gdrive/$GDRIVEUSER2/pigshell-test
    TMP1="/home/tmp/cptest/cptest-gdrive"
    TMP2="/home/tmp/cptest/cptest-gdrive/pdf"

    if ! [ -d $DSTDIR ]; then echo "GDRIVEUSER1 not available; skipping"; return; fi

    mkdir $TMP1 $TMP2 2>/dev/null

    # Upload docs to GDrive with conversion
    rm $DSTDIR/sampledocs/* 2>/dev/null
    cp -vr -o gdrive.convert $SRCDIR $DSTDIR 2>$RESDIR/cp.gdoc.1
    dcheck $? true cp.gdoc.1

    # Download docs back
    rm $TMP1/sampledocs/* 2>/dev/null
    cp -vr $DSTDIR/sampledocs $TMP1 2>$RESDIR/cp.gdoc.2
    dcheck $? true cp.gdoc.2
    # Verify manually

    # With -c, we should get nothing
    cp -vrc $DSTDIR/sampledocs $TMP1 2>$RESDIR/cp.gdoc.3
    dcheck $? true cp.gdoc.3

    # Download as pdf
    rm $TMP2/* 2>/dev/null
    cp -vr -o gdrive.fmt=pdf $DSTDIR/sampledocs $TMP2 2>$RESDIR/cp.gdoc.4
    dcheck $? true cp.gdoc.4
    # Verify manually

    # Copy docs straight from one user to another
    if ! [ -d $DSTDIR2 ]; then echo "GDRIVEUSER2 not available; skipping"; return; fi
    rm $DSTDIR2/sampledocs/* 2>/dev/null
    cp -vr -o gdrive.convert $DSTDIR/sampledocs $DSTDIR2 2>$RESDIR/cp.gdoc.5
    dcheck $? true cp.gdoc.5
    # Verify manually

}

ramfs_test
pstyfs_test
gdrivefs_test
gdrivefs_doc_test
